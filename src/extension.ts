// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { generateFiles, generateBatchModels } from "./lib/generateFiles";
import { getImportsForContent } from "./resolveImports";
import SwaggerParser from "@apidevtools/swagger-parser";
import * as prettier from "prettier";

export function activate(context: vscode.ExtensionContext) {
    console.log("React Query Hook Builder is now active!");

    const appendToFile = async (
        content: string,
        label: string,
        stateKey: string
    ) => {
        if (!content || !content.trim()) {
            return;
        }

        let targetPath: string | undefined;
        const lastPath = context.workspaceState.get<string>(stateKey);

        // If we have a valid last path, ask user if they want to reuse it
        if (lastPath) {
            try {
                const fs = require("fs");
                if (fs.existsSync(lastPath)) {
                    const useLast = {
                        label: `$(history) Use last used: ${vscode.workspace.asRelativePath(
                            lastPath
                        )}`,
                        path: lastPath,
                    };
                    const pickNew = {
                        label: `$(folder-opened) Choose new file...`,
                        path: undefined,
                    };

                    const selection = await vscode.window.showQuickPick(
                        [useLast, pickNew],
                        {
                            placeHolder: `Select destination for ${label}`,
                            ignoreFocusOut: true,
                        }
                    );

                    if (selection?.path) {
                        targetPath = selection.path;
                    } else if (!selection) {
                        // User cancelled quick pick
                        return;
                    }
                }
            } catch (e) {
                // ignore fs errors
            }
        }

        // If no target path set (either no history or user chose 'new'), show dialog
        if (!targetPath) {
            const defaultUri = lastPath ? vscode.Uri.file(lastPath) : undefined;
            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: `Append ${label}`,
                title: `Select file to append ${label}`,
                defaultUri,
            });

            if (fileUris && fileUris.length > 0) {
                targetPath = fileUris[0].fsPath;
                // Update history
                await context.workspaceState.update(stateKey, targetPath);
            }
        }

        if (targetPath) {
            try {
                const fs = require("fs");
                let fileContent = "";
                if (fs.existsSync(targetPath)) {
                    fileContent = fs.readFileSync(targetPath, "utf8");
                }

                const newImports = await getImportsForContent(
                    content,
                    targetPath,
                    fileContent
                );
                let finalContent = fileContent;

                if (newImports.length > 0) {
                    finalContent =
                        newImports.join("\n") + "\n\n" + finalContent;
                }

                finalContent += "\n\n" + content;

                fs.writeFileSync(targetPath, finalContent);
                vscode.window.showInformationMessage(
                    `Appended ${label} to ${vscode.workspace.asRelativePath(
                        targetPath
                    )}`
                );
            } catch (err) {
                vscode.window.showErrorMessage(
                    `Failed to write to file: ${err}`
                );
            }
        }
    };

    const formatCode = async (code: string): Promise<string> => {
        try {
            // Try to resolve prettier config from workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            let options: prettier.Options = { parser: "typescript" };
            
            if (workspaceFolders && workspaceFolders.length > 0) {
                const configFile = await prettier.resolveConfig(workspaceFolders[0].uri.fsPath);
                if (configFile) {
                    options = { ...configFile, parser: "typescript" };
                }
            }
            
            return await prettier.format(code, options);
        } catch (e) {
            console.error("Prettier formatting failed", e);
            return code;
        }
    };

    let disposable = vscode.commands.registerCommand(
        "extension.generateHook",
        async () => {
            // 1. Get Feature Name
            const featureName = await vscode.window.showInputBox({
                prompt: "Enter feature name (e.g. getAudienceList): ",
                ignoreFocusOut: true,
            });

            const methodType = await vscode.window.showQuickPick(
                ["GET", "POST", "PUT", "DELETE", "PATCH"],
                {
                    placeHolder: "Select HTTP Method",
                    ignoreFocusOut: true,
                }
            );

            // 3. Get API URL
            const apiUrl = await vscode.window.showInputBox({
                prompt: "Enter API Endpoint URL: ",
                ignoreFocusOut: true,
            });

            const exampleResponse = await vscode.window.showInputBox({
                prompt: "Enter example JSON response: ",
                ignoreFocusOut: true,
            });

            const headers = await vscode.window.showInputBox({
                prompt: "Enter example params or payload (JSON): ",
                ignoreFocusOut: true,
            });

            // 2. Select Hook Type
            const hookType = await vscode.window.showQuickPick(
                ["useQuery", "useMutation", "useInfiniteQuery"],
                {
                    placeHolder: "Select Hook Type",
                }
            );

            if (!featureName || !methodType || !apiUrl || !hookType) {
                vscode.window.showErrorMessage("Missing required inputs");
                return;
            }

            try {
                const generated = await generateFiles({
                    featureName,
                    methodType,
                    apiUrl,
                    exampleResponse: exampleResponse || "",
                    params: headers || "",
                    hookType,
                });

                // Ask for each part with unique state keys
                if (generated.model) {
                    const formatted = await formatCode(generated.model);
                    await appendToFile(
                        formatted,
                        "Model/Types",
                        "lastPath_model"
                    );
                }
                if (generated.api) {
                   const formatted = await formatCode(generated.api);
                    await appendToFile(
                        formatted,
                        "API Function",
                        "lastPath_api"
                    );
                }
                if (generated.queryKey) {
                    const formatted = await formatCode(generated.queryKey);
                    await appendToFile(
                        formatted,
                        "Query Key",
                        "lastPath_queryKey"
                    );
                }
                if (generated.hook) {
                    const formatted = await formatCode(generated.hook);
                    await appendToFile(formatted, "Hook", "lastPath_hook");
                }
            } catch (e) {
                vscode.window.showErrorMessage("Error generating files: " + e);
            }
        }
    );

    let openApiDisposable = vscode.commands.registerCommand(
        "extension.generateHookFromOpenAPI",
        async () => {
            const history = context.workspaceState.get<string[]>("openApiSpecHistory") || [];
            let input: string | undefined;

            const historyItems: vscode.QuickPickItem[] = history.map((spec) => {
                 const isUrl = spec.trim().startsWith("http");
                 return {
                     label: isUrl ? `$(globe) ${spec}` : `$(json) JSON Content (substring)`,
                     description: isUrl ? "URL" : spec.substring(0, 50) + "...",
                     detail: "From History",
                     picked: false,
                     input: spec
                 } as vscode.QuickPickItem & { input: string };
            });

            const newSpecItem = {
                label: `$(plus) Enter new OpenAPI Spec URL or JSON content`,
                description: "Input new spec",
                input: undefined
            };

            const selection = await vscode.window.showQuickPick(
                [newSpecItem, ...historyItems],
                { placeHolder: "Select OpenAPI source" }
            );

            if (!selection) return;

            if ((selection as any).input === undefined) {
                    input = await vscode.window.showInputBox({
                    prompt: "Enter OpenAPI Spec URL or Paste JSON content",
                    ignoreFocusOut: true,
                });
            } else {
                input = (selection as any).input;
            }

            if (!input) {
                return;
            }

            try {
                let spec: any;
                const trimmedInput = input.trim();

                try {
                    // Normalize input for SwaggerParser
                    if (trimmedInput.startsWith("{")) {
                        // If it looks like JSON object, parse it first
                        const jsonInput = JSON.parse(trimmedInput);
                        spec = await SwaggerParser.dereference(jsonInput);
                    } else {
                        // Assume URL or file path
                        spec = await SwaggerParser.dereference(trimmedInput);
                    }
                } catch (e) {
                     // Fallback/Retry logic could go here, but for now we error out or try bundle?
                     // Let's try to parse as JSON if it failed and didn't start with { (maybe user pasted json without braces? unlikely)
                     throw new Error(`Failed to parse/dereference spec: ${(e as any).message}`);
                }

                if (!spec.paths) {
                    throw new Error("Invalid OpenAPI spec: no paths found");
                }

                // Save to history if valid
                let newHistory = history.filter(h => h !== input);
                newHistory.unshift(input);
                if (newHistory.length > 10) newHistory = newHistory.slice(0, 10);
                await context.workspaceState.update("openApiSpecHistory", newHistory);

                const items: (vscode.QuickPickItem & {
                    path: string;
                    method: string;
                    operation: any;
                })[] = [];

                for (const [path, methods] of Object.entries(spec.paths)) {
                    for (const [method, operation] of Object.entries(methods as any)) {
                        const op = operation as any;
                        items.push({
                            label: `${method.toUpperCase()} ${path}`,
                            description: op.summary || op.operationId,
                            detail: path,
                            path,
                            method,
                            operation: op,
                        });
                    }
                }

                const selectedItems = await vscode.window.showQuickPick(items, {
                    placeHolder: "Select Endpoint(s) to generate hook for",
                    ignoreFocusOut: true,
                    matchOnDetail: true,
                    matchOnDescription: true,
                    canPickMany: true
                });

                if (!selectedItems || selectedItems.length === 0) {
                    return;
                }

                const generatedResults = {
                    model: [] as string[],
                    api: [] as string[],
                    queryKey: [] as string[],
                    hook: [] as string[]
                };

                const batchModelsInput: { featureName: string; responseSchema?: string; paramsSchema?: string }[] = [];
                const processedItems: any[] = []; // To store computed schemas for 2nd pass

                for (const selected of selectedItems) {
                    const { path, method, operation } = selected;
                    
                    // Determine Feature Name
                    let featureName = operation.operationId;
                    if (!featureName) {
                        // fallback to path parts
                        const parts = path.split('/').filter(p => p && !p.startsWith('{'));
                        featureName = parts.length > 0 ? parts[parts.length - 1] : 'feature';
                        featureName = method + featureName.charAt(0).toUpperCase() + featureName.slice(1);
                    }
                    
                    // Determine Response Schema
                    let responseSchemaStr: string | undefined;
                    // Since spec is dereferenced, we just look up the success response schema
                    const successCode = Object.keys(operation.responses || {}).find(code => code.startsWith('2'));
                    const successResponse = successCode ? operation.responses[successCode] : undefined;
                    
                    if (successResponse && successResponse.content?.["application/json"]?.schema) {
                        try {
                            const schema = successResponse.content["application/json"].schema;
                            // Ensure valid schema for quicktype (might be circular, try/catch stringify)
                            responseSchemaStr = JSON.stringify(schema);
                        } catch (e) {
                            console.warn("Failed to stringify response schema (circular ref?)", e);
                        }
                    }
                    
                    // Determine Params Schema
                    let paramsSchemaStr: string | undefined;
                    const paramsProperties: Record<string, any> = {};
                    const requiredParams: string[] = [];

                    // Parameters (query, path)
                    if (operation.parameters) {
                        for (const param of operation.parameters) {
                             if (param.in === "query" || param.in === "path") {
                                 // schema is already dereferenced
                                 paramsProperties[param.name] = param.schema || {}; 
                                 if (param.required) {
                                     requiredParams.push(param.name);
                                 }
                             }
                        }
                    }

                    // Request Body
                    if (operation.requestBody) {
                         const bodyContent = operation.requestBody.content?.["application/json"];
                         if (bodyContent && bodyContent.schema) {
                             const bodySchema = bodyContent.schema;
                             
                             if (bodySchema.type === "object" && bodySchema.properties) {
                                  Object.assign(paramsProperties, bodySchema.properties);
                                  if (bodySchema.required) {
                                      requiredParams.push(...bodySchema.required);
                                  }
                             } else {
                                 paramsProperties['body'] = bodySchema;
                                 requiredParams.push('body');
                             }
                         }
                    }

                    if (Object.keys(paramsProperties).length > 0) {
                         const fullParamSchema: any = {
                             $schema: "http://json-schema.org/draft-07/schema#",
                             type: "object",
                             properties: paramsProperties,
                             required: requiredParams
                         };
                         
                         try {
                            paramsSchemaStr = JSON.stringify(fullParamSchema);
                         } catch (e) {
                             console.warn("Failed to stringify params schema", e);
                         }
                    }

                    batchModelsInput.push({
                        featureName,
                        responseSchema: responseSchemaStr,
                        paramsSchema: paramsSchemaStr
                    });

                    processedItems.push({
                         featureName,
                         method,
                         path,
                         responseSchemaStr,
                         paramsSchemaStr
                    });
                }

                // Generate Common/Batch Models
                const commonModels = await generateBatchModels(batchModelsInput);
                if (commonModels) {
                    generatedResults.model.push(commonModels);
                }
                
                // 2nd Pass: Generate API/Hook (Skipping model gen)
                for (const item of processedItems) {
                    const { featureName, method, path, responseSchemaStr, paramsSchemaStr } = item;
                     
                    const hookType = (method.toLowerCase() === 'get') ? 'useQuery' : 'useMutation';
                    
                    let adjustedPath = path;
                    if (adjustedPath.startsWith("/api")) {
                        adjustedPath = adjustedPath.substring(4); 
                    }

                    const generated = await generateFiles({
                        featureName,
                        methodType: method.toUpperCase(),
                        apiUrl: adjustedPath,
                        exampleResponse: "",
                        params: "",
                        responseSchema: responseSchemaStr,
                        paramsSchema: paramsSchemaStr,
                        hookType,
                        skipModelGeneration: true
                    });

                    if (generated.api) generatedResults.api.push(generated.api);
                    if (generated.queryKey) generatedResults.queryKey.push(generated.queryKey);
                    if (generated.hook) generatedResults.hook.push(generated.hook);
                }

                // Append Logic with Formatting
                if (generatedResults.model.length > 0) {
                    const formatted = await formatCode(generatedResults.model.join("\n\n"));
                    await appendToFile(formatted, "Model/Types", "lastPath_model");
                }
                if (generatedResults.api.length > 0) {
                    const formatted = await formatCode(generatedResults.api.join("\n\n"));
                    await appendToFile(formatted, "API Function", "lastPath_api");
                }
                if (generatedResults.queryKey.length > 0) {
                    const formatted = await formatCode(generatedResults.queryKey.join("\n\n"));
                    await appendToFile(formatted, "Query Key", "lastPath_queryKey");
                }
                if (generatedResults.hook.length > 0) {
                    const formatted = await formatCode(generatedResults.hook.join("\n\n"));
                    await appendToFile(formatted, "Hook", "lastPath_hook");
                }

            } catch (e) {
                vscode.window.showErrorMessage("Error generating hook from OpenAPI: " + e);
            }
        }
    );

    context.subscriptions.push(disposable, openApiDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
