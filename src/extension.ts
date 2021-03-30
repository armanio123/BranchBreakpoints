// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { Breakpoint, debug as vscodeDebug, ExtensionContext, workspace } from 'vscode';
import * as fs from 'fs';

interface BranchBreakpoints {
	branchName: string;
	breakpoints: Breakpoint[];
}

const breakpointMapKeyName = 'breakpointMap';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {
	// TODO: Fix the workspace stuff and watches.
	const headFilename = `${workspace.workspaceFolders[0].uri.fsPath}/.git/HEAD`;
	let branchBreakpoints = context.workspaceState.get<BranchBreakpoints[]>(breakpointMapKeyName) || [];
	let head = getHead(headFilename);
	let justActivated = true;
	let initializingBranch = false;

	fs.watch(headFilename, () => {
		initializingBranch = true;

		head = getHead(headFilename);
		initBreakpoints(branchBreakpoints, head);

		initializingBranch = false;
	});

	vscodeDebug.onDidChangeBreakpoints(e => {
		// If a branch is being initialized, don't perform any operation
		if (initializingBranch) {
			return;
		}

		const index = branchBreakpoints.findIndex(value => value.branchName === head);

		// If vscode has just loaded and we have already some breakpoints in place, only load them.
		if (justActivated && index !== -1) {
			initBreakpoints(branchBreakpoints, head);
			return;
		}

		let branchBreakpoint = index !== -1
			? branchBreakpoints[index]
			: { branchName: head, breakpoints: [] };

		if (e.added.length > 0) {
			branchBreakpoint.breakpoints.push(...e.added);
		}

		for (const breakpoint of e.changed) {
			const index = branchBreakpoint.breakpoints.findIndex(value => value.id === breakpoint.id);
			branchBreakpoint.breakpoints.splice(index, 1);
			branchBreakpoint.breakpoints = [...branchBreakpoint.breakpoints.slice(0, index), breakpoint, ...branchBreakpoint.breakpoints.slice(index + 1, branchBreakpoint.breakpoints.length)];
		}

		for (const breakpoint of e.removed) {
			const index = branchBreakpoint.breakpoints.findIndex(value => value.id === breakpoint.id);
			branchBreakpoint.breakpoints.splice(index, 1);
		}

		if (index === -1) {
			branchBreakpoints.push(branchBreakpoint);
		} else {
			branchBreakpoints[index] = branchBreakpoint;
		}

		justActivated = false;
		context.workspaceState.update(breakpointMapKeyName, branchBreakpoints);
	});
}

function initBreakpoints(branchBreakpoints: BranchBreakpoints[], head: string) {
	vscodeDebug.removeBreakpoints(vscodeDebug.breakpoints);

	const breakpoints = branchBreakpoints.find(value => value.branchName === head)?.breakpoints;
	if (breakpoints) {
		vscodeDebug.addBreakpoints(breakpoints);
	}
}

function getHead(headFilename: string): string {
	return fs.readFileSync(headFilename).toString();
}

// this method is called when your extension is deactivated
export function deactivate() { }
