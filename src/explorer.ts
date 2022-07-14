import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as rimraf from 'rimraf';
import { readFileSync } from "fs";


const EXTENSION_NAME = "file-structure-docs"
const CONFIG_FILE = "fsdocs.config.json";

var CONFIG: any;


namespace _ {

	function handleResult<T>(resolve: (result: T) => void, reject: (error: Error) => void, error: Error | null | undefined, result: T): void {
		if (error) {
			reject(massageError(error));
		} else {
			resolve(result);
		}
	}

	function massageError(error: Error & { code?: string }): Error {
		if (error.code === 'ENOENT') {
			return vscode.FileSystemError.FileNotFound();
		}

		if (error.code === 'EISDIR') {
			return vscode.FileSystemError.FileIsADirectory();
		}

		if (error.code === 'EEXIST') {
			return vscode.FileSystemError.FileExists();
		}

		if (error.code === 'EPERM' || error.code === 'EACCESS') {
			return vscode.FileSystemError.NoPermissions();
		}

		return error;
	}

	export function checkCancellation(token: vscode.CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new Error('Operation cancelled');
		}
	}

	export function normalizeNFC(items: string): string;
	export function normalizeNFC(items: string[]): string[];
	export function normalizeNFC(items: string | string[]): string | string[] {
		if (process.platform !== 'darwin') {
			return items;
		}

		if (Array.isArray(items)) {
			return items.map(item => item.normalize('NFC'));
		}

		return items.normalize('NFC');
	}

	export function readdir(path: string): Promise<string[]> {
		return new Promise<string[]>((resolve, reject) => {
			fs.readdir(path, (error, children) => handleResult(resolve, reject, error, normalizeNFC(children)));
		});
	}

	export function stat(path: string): Promise<fs.Stats> {
		return new Promise<fs.Stats>((resolve, reject) => {
			fs.stat(path, (error, stat) => handleResult(resolve, reject, error, stat));
		});
	}

	export function readfile(path: string): Promise<Buffer> {
		return new Promise<Buffer>((resolve, reject) => {
			fs.readFile(path, (error, buffer) => handleResult(resolve, reject, error, buffer));
		});
	}

	export function writefile(path: string, content: Buffer): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.writeFile(path, content, error => handleResult(resolve, reject, error, void 0));
		});
	}

	export function exists(path: string): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			fs.exists(path, exists => handleResult(resolve, reject, null, exists));
		});
	}

	export function rmrf(path: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			rimraf(path, error => handleResult(resolve, reject, error, void 0));
		});
	}

	export function mkdir(path: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			mkdirp(path, error => handleResult(resolve, reject, error, void 0));
		});
	}

	export function rename(oldPath: string, newPath: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.rename(oldPath, newPath, error => handleResult(resolve, reject, error, void 0));
		});
	}

	export function unlink(path: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.unlink(path, error => handleResult(resolve, reject, error, void 0));
		});
	}
}

export class FileStat implements vscode.FileStat {

	constructor(private fsStat: fs.Stats) { }

	get type(): vscode.FileType {
		return this.fsStat.isFile() ? vscode.FileType.File : this.fsStat.isDirectory() ? vscode.FileType.Directory : this.fsStat.isSymbolicLink() ? vscode.FileType.SymbolicLink : vscode.FileType.Unknown;
	}

	get isFile(): boolean | undefined {
		return this.fsStat.isFile();
	}

	get isDirectory(): boolean | undefined {
		return this.fsStat.isDirectory();
	}

	get isSymbolicLink(): boolean | undefined {
		return this.fsStat.isSymbolicLink();
	}

	get size(): number {
		return this.fsStat.size;
	}

	get ctime(): number {
		return this.fsStat.ctime.getTime();
	}

	get mtime(): number {
		return this.fsStat.mtime.getTime();
	}
}

interface Entry {
	uri: vscode.Uri;
	type: vscode.FileType;
}

//#endregion

export class FileSystemProvider implements vscode.TreeDataProvider<Entry>, vscode.FileSystemProvider {

	private _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;

	constructor() {
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	}

	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		const watcher = fs.watch(uri.fsPath, { recursive: options.recursive }, async (event: string, filename: string | Buffer) => {
			const filepath = path.join(uri.fsPath, _.normalizeNFC(filename.toString()));

			this._onDidChangeFile.fire([{
				type: event === 'change' ? vscode.FileChangeType.Changed : await _.exists(filepath) ? vscode.FileChangeType.Created : vscode.FileChangeType.Deleted,
				uri: uri.with({ path: filepath })
			} as vscode.FileChangeEvent]);
		});

		return { dispose: () => watcher.close() };
	}

	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
		return this._stat(uri.fsPath);
	}

	async _stat(path: string): Promise<vscode.FileStat> {
		return new FileStat(await _.stat(path));
	}

	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
		return this._readDirectory(uri);
	}

	async _readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const children = await _.readdir(uri.fsPath);

		const result: [string, vscode.FileType][] = [];
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			const stat = await this._stat(path.join(uri.fsPath, child));
			result.push([child, stat.type]);
		}

		return Promise.resolve(result);
	}

	createDirectory(uri: vscode.Uri): void | Thenable<void> {
		return _.mkdir(uri.fsPath);
	}

	readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
		return _.readfile(uri.fsPath);
	}

	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
		return this._writeFile(uri, content, options);
	}

	async _writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
		const exists = await _.exists(uri.fsPath);
		if (!exists) {
			if (!options.create) {
				throw vscode.FileSystemError.FileNotFound();
			}

			await _.mkdir(path.dirname(uri.fsPath));
		} else {
			if (!options.overwrite) {
				throw vscode.FileSystemError.FileExists();
			}
		}

		return _.writefile(uri.fsPath, content as Buffer);
	}

	delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
		if (options.recursive) {
			return _.rmrf(uri.fsPath);
		}

		return _.unlink(uri.fsPath);
	}

	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
		return this._rename(oldUri, newUri, options);
	}

	async _rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
		const exists = await _.exists(newUri.fsPath);
		
		if (exists) {
			if (!options.overwrite) {
				throw vscode.FileSystemError.FileExists();
			} else {
				await _.rmrf(newUri.fsPath);
			}
		}

		const parentExists = await _.exists(path.dirname(newUri.fsPath));
		if (!parentExists) {
			await _.mkdir(path.dirname(newUri.fsPath));
		}

		return _.rename(oldUri.fsPath, newUri.fsPath);
	}

	// tree data provider

	async getChildren(element?: Entry): Promise<Entry[]> {
		var uri = undefined;

		if (element) {
			uri = element.uri;
		} else {
			const workspaceFolder = vscode.workspace.workspaceFolders.filter(folder => folder.uri.scheme === 'file')[0];

			if (workspaceFolder) {
				uri = workspaceFolder.uri;
			}
		}

		if (uri === undefined) {
			return [];
		}

		const children = await this.readDirectory(uri);

		children.sort((a, b) => {
			if (a[1] === b[1]) {
				return a[0].localeCompare(b[0]);
			} else {
				return a[1] === vscode.FileType.Directory ? -1 : 1;
			}
		});

		return children.map(
			([name, type]) => 
				({ uri: vscode.Uri.file(path.join(uri.fsPath, name)), type })
		);
	}

	getTreeItem(element: Entry): vscode.TreeItem {		
		var name: string = element.uri.toString().split("/").at(-1);

		if (name.startsWith(".") || name.startsWith("__")) {
			return undefined;
		}

		const treeItem = new vscode.TreeItem(
			element.uri, 
			element.type === vscode.FileType.Directory ? 
				vscode.TreeItemCollapsibleState.Collapsed : 
				vscode.TreeItemCollapsibleState.None
		);
		
		if (element.type === vscode.FileType.File) {
			treeItem.command = { 
				command: 'fsdocs-explorer.open', 
				title: "Open File", 
				arguments: [element.uri], 
			};

			treeItem.contextValue = 'file';
		}

		if (CONFIG === undefined) {
			return treeItem;
		}

		if (CONFIG["items"].hasOwnProperty(name)) {
			let item = CONFIG["items"][name];

			treeItem.description = this.makeTreeItemDescription(item);
			treeItem.tooltip = this.makeTreeItemTooltip(item);
		}

		return treeItem;
	}

	makeTreeItemDescription(item: any): string {
		var str = "";

		if (item.hasOwnProperty("environment")) {
			var environment = item["environment"];
			var environment_icon = CONFIG["environments"][environment];

			str += `${environment_icon} `;
		}

		if (item.hasOwnProperty("type")) {
			var type = item["type"];
			var type_icon = CONFIG["types"][type];

			str += `${type_icon} `;
		}

		str += item["label"];

		return str;
	}

	makeTreeItemTooltip(item: any): vscode.MarkdownString {
		const md = new vscode.MarkdownString();

		md.appendMarkdown(`**${item["label"]}**`);

		if (item.hasOwnProperty("environment")) {
			var environment = item["environment"];
			var environment_icon = CONFIG["environments"][environment];

			md.appendMarkdown(` [${environment_icon} · ${environment}]`);
		}
		
		if (item.hasOwnProperty("type")) {
			var type = item["type"];
			var type_icon = CONFIG["types"][type];

			md.appendMarkdown(` [${type_icon} · ${type}]`)
		}

		if (item.hasOwnProperty("description")) {
			var description = item["description"];
			
			md.appendText("\n\n")
			md.appendCodeblock(description)
		}

		return md;
	}

}

export class FSDocsExplorer {
	constructor(context: vscode.ExtensionContext) {
		if (vscode.workspace.workspaceFolders === undefined) {
			return;
		} else if (vscode.workspace.workspaceFolders.length == 0) {
			return;
		} 

		const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
		const pattern = path.join(workspaceRoot, '*');
		
		let fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		fileWatcher.onDidChange(() => this.refresh(context));

		vscode.commands.registerCommand(
			'fsdocs-explorer.open', 
			(resource) => this.open(resource)
		);

		vscode.commands.registerCommand(
			'fsdocs-explorer.open-config-file', 
			(resource) => this.open_config_file()
		);

		vscode.commands.registerCommand(
			'fsdocs-explorer.copy_label', 
			(resource) => this.copy_label(resource)
		);

		vscode.commands.registerCommand(
			'fsdocs-explorer.copy_name', 
			(resource) => this.copy_name(resource)
		);

		vscode.commands.registerCommand(
			'fsdocs-explorer.reveal', 
			(resource) => this.reveal(resource)
		);

		vscode.commands.registerCommand(
			'fsdocs-explorer.refresh', 
			(resource) => this.refresh(context)
		);

		this.refresh(context);
	}

	private open(resource: any): void {
		vscode.window.showTextDocument(resource);
	}

	private async open_config_file() {
		const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
		const config_file_path = path.join(workspaceRoot, CONFIG_FILE);
		const config_file_uri = vscode.Uri.file(config_file_path);

		try {
			await vscode.workspace.fs.stat(config_file_uri);
			
			vscode.workspace.openTextDocument(config_file_uri);
			vscode.window.showTextDocument(config_file_uri);
		} catch {
			vscode.window.showInformationMessage(`${config_file_uri.toString()} file doesn't exist`);
			var template: string = readFileSync("assets/fsdocs.template.json").toString();

			const newFile = vscode.Uri.parse('untitled:' + config_file_path);
			vscode.workspace.openTextDocument(newFile).then(document => {
				const edit = new vscode.WorkspaceEdit();
				edit.insert(newFile, new vscode.Position(0, 0), template);

				return vscode.workspace.applyEdit(edit);
			});
		}
	}

	private copy_label(resource: any): void {
		var name: string = resource.uri.toString().split("/").at(-1);
		
		if (CONFIG["items"].hasOwnProperty(name)) {
			var label: string = CONFIG["items"][name]["label"]

			vscode.env.clipboard.writeText(label);
			vscode.window.showInformationMessage(`Copied '${label}' to clipboard`);
		} else {
			vscode.window.showErrorMessage(`Item '${name}' has no label`);
		}
	}
	
	private copy_name(resource: any): void {
		var name: string = resource.uri.toString().split("/").at(-1);

		vscode.env.clipboard.writeText(name);
		vscode.window.showInformationMessage(`Copied '${name}' to clipboard`);
	}

	private reveal(resource: any): void {
		vscode.commands.executeCommand('revealInExplorer', resource.uri);
	}

	private refresh(context: vscode.ExtensionContext): void {
		this.load_configuration();

		const treeDataProvider = new FileSystemProvider();
		context.subscriptions.push(
			vscode.window.createTreeView(
				'fsdocs-explorer', 
				{ treeDataProvider }
			)
		);
	}

	private load_configuration(): any {
		if(vscode.workspace.workspaceFolders === undefined) {
			return JSON.parse("{}");
		}
		
		let working_directory = vscode.workspace.workspaceFolders[0].uri.fsPath;
		const config_path = path.join(working_directory, CONFIG_FILE);
		
		try {
			CONFIG = JSON.parse(readFileSync(config_path).toString());
		} catch (error) {
			if (error.code == "ENOENT") {
				console.error(`${EXTENSION_NAME}: missing config file '${CONFIG_FILE}'.`);
			} else if (error.name == "SyntaxError") {
				vscode.window.showErrorMessage(`${EXTENSION_NAME}: config file is not a valid JSON file.`);
			}

			CONFIG = undefined;
		}
	}
}