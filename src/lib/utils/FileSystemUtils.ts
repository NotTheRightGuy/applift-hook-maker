
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// Custom QuickPick for file navigation
const pickFile = async (currentDir: string): Promise<string | undefined> => {
    try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        const items: vscode.QuickPickItem[] = [];
        
        // Add ".." option if not at root of drive/workspace (heuristic)
        const parentDir = path.dirname(currentDir);
        if (parentDir !== currentDir) {
            items.push({ label: "$(folder) ..", description: "Go up", detail: parentDir });
        }

        // Sort: Directories first, then files
        const dirs = entries.filter((e: any) => e.isDirectory()).sort((a: any, b: any) => a.name.localeCompare(b.name));
        const files = entries.filter((e: any) => e.isFile()).sort((a: any, b: any) => a.name.localeCompare(b.name));

        for (const d of dirs) {
            items.push({ label: `$(folder) ${d.name}`, description: "Folder", detail: path.join(currentDir, d.name) });
        }
        for (const f of files) {
            items.push({ label: `$(file) ${f.name}`, description: "File", detail: path.join(currentDir, f.name) });
        }

        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: `Select file in ${currentDir}`,
            ignoreFocusOut: true
        });

        if (!selection) {return undefined;}

        const selectedPath = selection.detail!;
        // If directory/up, recurse
        if (selection.label.startsWith("$(folder)")) {
            return pickFile(selectedPath);
        } else {
            return selectedPath;
        }
    } catch (e) {
        vscode.window.showErrorMessage(`Error reading directory: ${e}`);
        return undefined;
    }
 };

export const selectTargetFile = async (
    context: vscode.ExtensionContext,
    label: string,
    stateKey: string
): Promise<string | undefined> => {
    let targetPath: string | undefined;
    const lastPath = context.workspaceState.get<string>(stateKey);

    // If we have a valid last path, ask user if they want to reuse it
    if (lastPath) {
        try {
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
                    return undefined;
                }
            }
        } catch (e) {
            // ignore fs errors
        }
    }

    // If no target path set (either no history or user chose 'new'), show directory picker
    if (!targetPath) {
         // Start picking from workspace root or last path's dir
         let startDir = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
         if (lastPath) {
             startDir = path.dirname(lastPath);
         }
         
         if (startDir) {
             targetPath = await pickFile(startDir);
             if (targetPath) {
                 // Update history
                 await context.workspaceState.update(stateKey, targetPath);
             }
         }
    }
    return targetPath;
};

export const appendContentToFile = async (
    targetPath: string,
    content: string,
    label: string,
    knownLocations?: Record<string, string>
) => {
    try {
        let fileContent = "";
        if (fs.existsSync(targetPath)) {
            fileContent = fs.readFileSync(targetPath, "utf8");
        }

        const finalContent = fileContent + "\n\n" + content;

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
};

export const appendToFile = async (
    context: vscode.ExtensionContext,
    content: string,
    label: string,
    stateKey: string,
    knownLocations?: Record<string, string>
): Promise<string | undefined> => {
    if (!content || !content.trim()) {
        return undefined;
    }
    
    const targetPath = await selectTargetFile(context, label, stateKey);
    
    if (targetPath) {
        await appendContentToFile(targetPath, content, label, knownLocations);
        return targetPath;
    }
    return undefined;
};
