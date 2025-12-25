
import * as vscode from "vscode";
import { generateFiles, generateBatchModels } from "../lib/generateFiles";
import { appendToFile } from "../lib/utils/FileSystemUtils";
import { formatCode } from "../lib/utils/FormatUtils";
import { parseOpenApiSpec, getOperationsFromSpec, processSelectedOperations } from "../lib/utils/OpenApiUtils";

export async function generateHookFromOpenApiCommand(context: vscode.ExtensionContext) {
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

    if (!selection) {return;}

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
        const spec = await parseOpenApiSpec(input);

        if (!spec.paths) {
            throw new Error("Invalid OpenAPI spec: no paths found");
        }

        // Save to history if valid
        let newHistory = history.filter(h => h !== input);
        newHistory.unshift(input);
        if (newHistory.length > 10) {newHistory = newHistory.slice(0, 10);}
        await context.workspaceState.update("openApiSpecHistory", newHistory);

        const items = getOperationsFromSpec(spec);

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

        const { batchModelsInput, processedItems } = processSelectedOperations(selectedItems, spec);
        
        const generatedResults = {
            model: [] as string[],
            api: [] as string[],
            queryKey: [] as string[],
            hook: [] as string[]
        };

        // Generate Common/Batch Models
        const commonModels = await generateBatchModels(batchModelsInput);
        if (commonModels) {
            generatedResults.model.push(commonModels);
        }
        
        // 2nd Pass: Generate API/Hook (Skipping model gen)
        for (const item of processedItems) {
            const { featureName, method, path, responseSchemaStr, paramsSchemaStr, wrapperArgs } = item;
                
            let hookType = (method.toLowerCase() === 'get') ? 'useQuery' : 'useMutation';
            if (hookType === 'useQuery' && wrapperArgs === 'WithRecordResponse') {
                hookType = 'useInfiniteQuery';
            }
            
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
                skipModelGeneration: true,
                wrapperArgs
            });

            if (generated.api) {generatedResults.api.push(generated.api);}
            if (generated.queryKey) {generatedResults.queryKey.push(generated.queryKey);}
            if (generated.hook) {generatedResults.hook.push(generated.hook);}
            if (generated.model) {generatedResults.model.push(generated.model);}
        }

        // Append Logic with Formatting
        
        if (generatedResults.model.length > 0) {
            const formatted = await formatCode(generatedResults.model.join("\n\n"));
            await appendToFile(context, formatted, "Model/Types", "lastPath_model");
        }
        if (generatedResults.api.length > 0) {
            const formatted = await formatCode(generatedResults.api.join("\n\n"));
            await appendToFile(context, formatted, "API Function", "lastPath_api");
        }
        if (generatedResults.queryKey.length > 0) {
            const formatted = await formatCode(generatedResults.queryKey.join("\n\n"));
            await appendToFile(context, formatted, "Query Key", "lastPath_queryKey");
        }
        if (generatedResults.hook.length > 0) {
            const formatted = await formatCode(generatedResults.hook.join("\n\n"));
            await appendToFile(context, formatted, "Hook", "lastPath_hook");
        }

    } catch (e) {
        vscode.window.showErrorMessage("Error generating hook from OpenAPI: " + e);
    }
}
