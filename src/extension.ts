import { Breakpoint, debug as vscodeDebug, ExtensionContext, FunctionBreakpoint, Location, Position, Range, SourceBreakpoint, Uri, workspace } from 'vscode';
import * as fs from 'fs';

interface JsonBreakpoint {
	// Breakpoint data
	enabled: boolean;
	condition?: string;
	hitCondition?: string;
	logMessage?: string;

	// SourceBreakpoint or FunctionBreakpoint data
	location?: {
		uri: {
			path: string,
		}
		range: [{
			line: number;
			character: number;
		}, {
			line: number;
			character: number;
		}]
	};
	functionName?: string;
}

interface JsonBranchBreakpoints {
	branchName: string;
	breakpoints: JsonBreakpoint[];
}

interface BranchBreakpoints {
	branchName: string;
	breakpoints: (SourceBreakpoint | FunctionBreakpoint | Breakpoint)[];
}

const breakpointMapKeyName = 'breakpointMap';

export function activate(context: ExtensionContext) {
	let branchBreakpoints = getBranchBreakpoints(context);

	// TODO: Fix headFilename when workspace is `undefined`.
	// TODO: Support workspaces.
	const workspaceFolders = workspace.workspaceFolders;
	const headFilename = workspaceFolders && workspaceFolders.length === 1 ? `${workspaceFolders[0].uri.fsPath}/.git/HEAD` : undefined;
	let isBranchLocked = false;

	// Default head to no name for folders not using git.
	let head = '__noBranchName';
	if (headFilename && fs.existsSync(headFilename)) {
		head = getHead(headFilename);

		// TODO: Check out vscode fs watch instead.
		fs.watch(headFilename, () => {
			head = getHead(headFilename);
			setBreakpoints();
		});
	}

	// TODO: Sometimes when vscode loads it triggers this event, saving the previously existing breakpoints.
	// affects when branches are changed with vscode closed.
	vscodeDebug.onDidChangeBreakpoints(e => {
		// If a branch is active, don't perform any operation
		if (isBranchLocked) {
			return;
		}

		const index = branchBreakpoints.findIndex(value => value.branchName === head);

		let branchBreakpoint = index !== -1
			? branchBreakpoints[index]
			: { branchName: head, breakpoints: [] };

		if (e.added.length > 0) {
			branchBreakpoint.breakpoints.push(...e.added);
		}

		for (const breakpoint of e.changed) {
			const index = branchBreakpoint.breakpoints.findIndex(value => value.id === breakpoint.id);
			branchBreakpoint.breakpoints.splice(index, 1);
			branchBreakpoint.breakpoints = [
				...branchBreakpoint.breakpoints.slice(0, index),
				breakpoint,
				...branchBreakpoint.breakpoints.slice(index + 1, branchBreakpoint.breakpoints.length)];
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

		context.workspaceState.update(breakpointMapKeyName, branchBreakpoints);
	});

	function setBreakpoints() {
		// Branch needs to get locked and unlocked as it will trigger multiple times the 
		// onDidChangeBreakpoints event.
		isBranchLocked = true;

		// Remove all breakpoints to then add only the saved ones.
		vscodeDebug.removeBreakpoints(vscodeDebug.breakpoints);

		const breakpoints = branchBreakpoints.find(value => value.branchName === head)?.breakpoints;
		if (breakpoints && breakpoints.length !== 0) {
			vscodeDebug.addBreakpoints(breakpoints as Breakpoint[]);
		}

		isBranchLocked = false;
	}
}

function getBranchBreakpoints(context: ExtensionContext): BranchBreakpoints[] {
	const jsonBranchBreakpoints = context.workspaceState.get<JsonBranchBreakpoints[]>(breakpointMapKeyName) || [];

	const result: BranchBreakpoints[] = [];
	for (const jsonBranchBreakpoint of jsonBranchBreakpoints) {
		const { branchName } = jsonBranchBreakpoint;
		const breakpoints: Breakpoint[] = [];
		for (const breakpoint of jsonBranchBreakpoint.breakpoints) {
			const bp = getBreakpoint(breakpoint);
			if (bp) {
				breakpoints.push(bp);
			}
		}

		result.push({
			branchName,
			breakpoints
		});
	}

	return result;
}

function getBreakpoint(breakpoint: JsonBreakpoint): Breakpoint | undefined {
	const { enabled, condition, functionName, hitCondition, location, logMessage } = breakpoint;

	// Instantiate the breakpoint.
	if (location) {
		const uri = Uri.parse(location.uri.path);

		const start = new Position(location.range[0].line, location.range[0].character);
		const end = new Position(location.range[1].line, location.range[1].character);
		const range = new Range(start, end);

		const locationInstance = new Location(uri, range);

		return new SourceBreakpoint(locationInstance, enabled, condition, hitCondition, logMessage);
	} else if (functionName) {
		return new FunctionBreakpoint(functionName, enabled, condition, hitCondition, logMessage);
	} else {
		console.error('location or functionName has not been defined on the breakpoint.');
	}
}

function getHead(headFilename: string): string {
	return fs.readFileSync(headFilename).toString();
}

export function deactivate() { }
