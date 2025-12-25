// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { generateFiles } from "./lib/generateFiles";
import { getImportsForContent } from "./resolveImports";

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
                    await appendToFile(
                        generated.model,
                        "Model/Types",
                        "lastPath_model"
                    );
                }
                if (generated.api) {
                    await appendToFile(
                        generated.api,
                        "API Function",
                        "lastPath_api"
                    );
                }
                if (generated.queryKey) {
                    await appendToFile(
                        generated.queryKey,
                        "Query Key",
                        "lastPath_queryKey"
                    );
                }
                if (generated.hook) {
                    await appendToFile(generated.hook, "Hook", "lastPath_hook");
                }
            } catch (e) {
                vscode.window.showErrorMessage("Error generating files: " + e);
            }
        }
    );

    let openApiDisposable = vscode.commands.registerCommand(
        "extension.generateHookFromOpenAPI",
        async () => {
            const lastInput = context.workspaceState.get<string>("lastOpenApiSpec");
            let input: string | undefined;

            if (lastInput) {
                const isUrl = lastInput.trim().startsWith("http");
                const label = isUrl
                    ? `Use last used URL: ${lastInput}`
                    : `Use last used JSON content (${lastInput.substring(0, 50)}...)`;
                
                const selection = await vscode.window.showQuickPick(
                    [
                        { label: "$(history) " + label, description: "Reuse previous spec", picked: true, input: lastInput },
                        { label: "$(edit) Enter new OpenAPI Spec URL or JSON content", description: "Input new spec", input: undefined }
                    ],
                    { placeHolder: "Select OpenAPI source" }
                );

                if (!selection) return;

                if (selection.input === undefined) {
                     input = await vscode.window.showInputBox({
                        prompt: "Enter OpenAPI Spec URL or Paste JSON content",
                        ignoreFocusOut: true,
                    });
                } else {
                    input = selection.input;
                }
            } else {
                 input = await vscode.window.showInputBox({
                    prompt: "Enter OpenAPI Spec URL or Paste JSON content",
                    ignoreFocusOut: true,
                });
            }

            if (!input) {
                return;
            }

            try {
                let spec: any;
                const trimmedInput = input.trim();

                if (trimmedInput.startsWith("http://") || trimmedInput.startsWith("https://")) {
                     const response = await fetch(trimmedInput);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch OpenAPI spec: ${response.statusText}`);
                    }
                    spec = (await response.json()) as any;
                } else {
                    try {
                        spec = JSON.parse(trimmedInput);
                    } catch (e) {
                        throw new Error("Input is neither a valid URL nor a valid JSON string.");
                    }
                }

                if (!spec.paths) {
                    throw new Error("Invalid OpenAPI spec: no paths found");
                }

                // Save to history if valid
                await context.workspaceState.update("lastOpenApiSpec", input);

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

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: "Select Endpoint to generate hook for",
                    ignoreFocusOut: true,
                    matchOnDetail: true,
                    matchOnDescription: true,
                });

                if (!selected) {
                    return;
                }

                const { path, method, operation } = selected;
                
                // Determine Feature Name
                let defaultFeatureName = operation.operationId;
                if (!defaultFeatureName) {
                    // fallback to path parts
                    const parts = path.split('/').filter(p => p && !p.startsWith('{'));
                    defaultFeatureName = parts.length > 0 ? parts[parts.length - 1] : 'feature';
                    defaultFeatureName = method + defaultFeatureName.charAt(0).toUpperCase() + defaultFeatureName.slice(1);
                }

                const featureName = await vscode.window.showInputBox({
                    prompt: "Enter feature name",
                    value: defaultFeatureName,
                    ignoreFocusOut: true
                });

                if (!featureName) return;

                // Determine Response Schema
                let responseSchemaStr: string | undefined;
                const successCode = Object.keys(operation.responses || {} as Record<string, any>).find(code => code.startsWith('2'));
                const successResponse = successCode ? operation.responses[successCode] : undefined;
                
                if (successResponse) {
                    const schema = successResponse.content?.["application/json"]?.schema;
                    if (schema) {
                        // Construct synthetic schema with components
                        const fullSchema: any = {
                             $schema: "http://json-schema.org/draft-07/schema#",
                             ...schema
                        };
                        
                        if (spec.components) {
                            fullSchema.components = spec.components;
                        }
                        if (spec.definitions) {
                            fullSchema.definitions = spec.definitions;
                        }
                        responseSchemaStr = JSON.stringify(fullSchema);
                    }
                }
                
                let exampleResponse = "";
                if (!responseSchemaStr) {
                    const selection = await vscode.window.showQuickPick(
                        ["Yes", "No"],
                        { placeHolder: "No response schema found. Paste example JSON response?" }
                    );
                    
                    if (selection === "Yes") {
                        exampleResponse = await vscode.window.showInputBox({
                            prompt: "Enter example JSON response",
                            ignoreFocusOut: true
                        }) || "";
                    }
                }

                // Determine Params Schema
                let paramsSchemaStr: string | undefined;
                // Merge parameters and requestBody
                const paramsProperties: Record<string, any> = {};
                const requiredParams: string[] = [];

                if (operation.parameters) {
                    for (const param of operation.parameters) {
                        if (param.in === "query" || param.in === "path") {
                            paramsProperties[param.name] = param.schema || {}; // Handle simple schema
                            if (param.required) {
                                requiredParams.push(param.name);
                            }
                        }
                    }
                }

                if (operation.requestBody) {
                    let bodySchema = operation.requestBody.content?.["application/json"]?.schema;
                    
                    if (bodySchema) {
                        // Resolve Reference if needed
                        if (bodySchema.$ref) {
                             const refPath = bodySchema.$ref;
                             // Basic resolution for #/components/schemas/Name or #/definitions/Name
                             const parts = refPath.split('/');
                             if (parts.length >= 3) {
                                 const name = parts[parts.length - 1];
                                 if (spec.components?.schemas?.[name]) {
                                     bodySchema = spec.components.schemas[name];
                                 } else if (spec.definitions?.[name]) {
                                     bodySchema = spec.definitions[name];
                                 }
                             }
                        }

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
                     
                     if (spec.components) {
                        fullParamSchema.components = spec.components;
                     }
                     if (spec.definitions) {
                        fullParamSchema.definitions = spec.definitions;
                     }

                     paramsSchemaStr = JSON.stringify(fullParamSchema);
                }

                // Select Hook Type
                const defaultHookType = (method.toLowerCase() === 'get') ? 'useQuery' : 'useMutation';
                // Move default to top
                const hookTypes = ["useQuery", "useMutation", "useInfiniteQuery"].sort((a,b) => (a === defaultHookType ? -1 : 1));

                const hookType = await vscode.window.showQuickPick(
                    hookTypes,
                    {
                        placeHolder: `Select Hook Type (Recommended: ${defaultHookType})`,
                    }
                );
                
                if (!hookType) return;
                
                const generated = await generateFiles({
                    featureName,
                    methodType: method.toUpperCase(),
                    apiUrl: path,
                    exampleResponse: exampleResponse,
                    params: "",
                    responseSchema: responseSchemaStr,
                    paramsSchema: paramsSchemaStr,
                    hookType,
                });

                // Append Logic
                if (generated.model) {
                    await appendToFile(generated.model, "Model/Types", "lastPath_model");
                }
                if (generated.api) {
                    await appendToFile(generated.api, "API Function", "lastPath_api");
                }
                if (generated.queryKey) {
                    await appendToFile(generated.queryKey, "Query Key", "lastPath_queryKey");
                }
                if (generated.hook) {
                    await appendToFile(generated.hook, "Hook", "lastPath_hook");
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
