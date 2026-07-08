// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import { HwpxGenerator } from "./hwpxGenerator";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "md2hwpx" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand("md2hwpx.exportToHwp", async () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        // 현재 활성화된 에디터를 가져옵니다.
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            vscode.window.showErrorMessage("열려있는 파일이 없습니다.");
            return;
        }

        const document = editor.document;

        // 마크다운 파일인지 확인합니다.
        if (document.languageId !== "markdown") {
            vscode.window.showWarningMessage("마크다운(.md) 파일에서만 실행할 수 있습니다.");
            return;
        }

        const mdContent = document.getText();

        // TODO: 여기서 마크다운 텍스트(mdContent)를 HWP로 변환하는 로직이 들어갈 예정입니다.
        vscode.window.showInformationMessage("마크다운 파일을 한글 문서로 변환할 준비가 되었습니다!");
        const currentFilePath = editor.document.uri.fsPath;

        // 저장할 경로 설정 (현재 마크다운 파일 이름과 동일한 .hwpx 파일)
        const outputFilePath = currentFilePath.replace(".md", ".hwpx");

        // 빈 HWPX 템플릿 경로 설정 (프로젝트 최상단 루트에 'template.hwpx'를 미리 만들어두세요)
        const templatePath = path.join(context.extensionPath, "template.hwpx");

        try {
            // 저장 처리 중임을 알리는 메시지
            vscode.window.showInformationMessage("HWPX 파일로 변환을 시작합니다...");

            const generator = new HwpxGenerator();
            await generator.generate(mdContent, templatePath, outputFilePath);

            vscode.window.showInformationMessage(`변환 완료! 저장 위치: ${outputFilePath}`);
        } catch (error) {
            vscode.window.showErrorMessage("변환 중 오류가 발생했습니다. 자세한 내용은 디버그 콘솔을 확인하세요.");
        }
    });

    context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
