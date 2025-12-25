// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { generateFiles } from "./lib/generateFiles";
import { getImportsForContent } from "./resolveImports";

export function activate(context: vscode.ExtensionContext) {
    console.log("Applift Hook Maker is now active!");

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

            // 2. Select Hook Type (moved up or keep here, user order was mixed in existing file)
            // Existing file had hookType selection at the end. I'll keep it there.

            // Re-ordering to match logical flow if needed, but keeping existing is fine.
            // Existing flows: Feature -> Method -> URL -> Response -> Params -> HookType.

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

                // Helper to ask and append
                const appendToFile = async (
                    content: string,
                    label: string,
                    stateKey: string
                ) => {
                    if (!content || !content.trim()) return;

                    let targetPath: string | undefined;
                    const lastPath =
                        context.workspaceState.get<string>(stateKey);

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

                                const selection =
                                    await vscode.window.showQuickPick(
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
                        const defaultUri = lastPath
                            ? vscode.Uri.file(lastPath)
                            : undefined;
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
                            await context.workspaceState.update(
                                stateKey,
                                targetPath
                            );
                        }
                    }

                    if (targetPath) {
                        try {
                            const fs = require("fs");
                            let fileContent = "";
                            if (fs.existsSync(targetPath)) {
                                fileContent = fs.readFileSync(
                                    targetPath,
                                    "utf8"
                                );
                            }

                            const newImports = await getImportsForContent(
                                content,
                                targetPath,
                                fileContent
                            );
                            let finalContent = fileContent;

                            if (newImports.length > 0) {
                                finalContent =
                                    newImports.join("\n") +
                                    "\n\n" +
                                    finalContent;
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

    context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
