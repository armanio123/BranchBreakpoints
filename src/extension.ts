import { Breakpoint, BreakpointsChangeEvent, commands, debug as vscodeDebug, ExtensionContext, FunctionBreakpoint, Location, OutputChannel, Position, Range, SourceBreakpoint, Uri, window, workspace } from 'vscode';
import * as fs from 'fs';
import { areBreakpointsEqual, Branch, BranchBreakpoints, JsonBreakpoint } from './types';

const breakpointMapKeyName = 'breakpointMap';
const configurationSection = 'branchBreakpoints';
const traceConfiguration = 'trace';

let outputChannel: OutputChannel | undefined;

export function activate(context: ExtensionContext) {
	createOutputChannel(workspace.getConfiguration(configurationSection).get(traceConfiguration));
	trace('Extension activated');

	let branchBreakpoints: BranchBreakpoints = update(context, context.workspaceState.get(breakpointMapKeyName) || getInitialBranchBreakpoints(context));
	trace(`Loaded breakpoints: ${JSON.stringify(branchBreakpoints)}`);

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
			trace(`Using head: ${head}`);

			setBreakpoints();
		});
	}
	trace(`Using head: ${head}`);

	const printMapCommand = commands.registerCommand('branchBreakpoints.printMap', () => {
		trace(`branchBreakpoints: ${JSON.stringify(branchBreakpoints)}`);
	});
	const clearMapCommand = commands.registerCommand('branchBreakpoints.clearMap', () => {
		branchBreakpoints = clearBranchBreakpoints(context, branchBreakpoints)
	});

	context.subscriptions.push(printMapCommand, clearMapCommand);

	// TODO: Sometimes when vscode loads it triggers this event, saving the previously existing breakpoints.
	// affects when branches are changed with vscode closed.
	vscodeDebug.onDidChangeBreakpoints(e => {
		const update = getUpdatedBreakpoints(e, isBranchLocked, branchBreakpoints, head);
		if (update) {
			branchBreakpoints = update;
			context.workspaceState.update(breakpointMapKeyName, branchBreakpoints);
			trace(`Branch breakpoints updated: ${JSON.stringify(branchBreakpoints)}`);
		}

	});
	workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration(configurationSection)) {
			const isTraceEnabled = workspace.getConfiguration(configurationSection).get<boolean>(traceConfiguration);
			if (isTraceEnabled) {
				createOutputChannel(isTraceEnabled);
			} else {
				outputChannel?.dispose();
				outputChannel = undefined;
			}
			trace(`Configuration changed: isTraceEnabled=${isTraceEnabled}`);
		}
	});

	function setBreakpoints() {
		// Branch needs to get locked and unlocked as it will trigger multiple times the 
		// onDidChangeBreakpoints event.
		isBranchLocked = true;

		// Remove all breakpoints to then add only the saved ones.
		trace(`Remove breakpoints: ${JSON.stringify(vscodeDebug.breakpoints)}`);
		vscodeDebug.removeBreakpoints(vscodeDebug.breakpoints);

		const branchBreakpoint = branchBreakpoints.branch.find(x => x.name === head);
		const breakpoints = branchBreakpoint?.breakpoints;

		if (breakpoints && breakpoints.length !== 0) {
			for (let i = 0; i < breakpoints.length; i++) {
				breakpoints[i] = getBreakpoint(breakpoints[i]);
			}

			vscodeDebug.addBreakpoints(breakpoints);

			trace(`Set breakpoints: ${JSON.stringify(breakpoints)}`);
		}

		isBranchLocked = false;
	}
}

export function deactivate() { }

function clearBranchBreakpoints(context: ExtensionContext, branchBreakpoints: BranchBreakpoints): BranchBreakpoints {
	branchBreakpoints = getInitialBranchBreakpoints(context);
	context.workspaceState.update(breakpointMapKeyName, undefined);

	trace(`Map cleared`);

	return branchBreakpoints;
}

function getInitialBranchBreakpoints(context: ExtensionContext): BranchBreakpoints {
	return {
		version: context.extension.packageJSON.version,
		branch: []
	};
}

function createOutputChannel(isTraceEnabled: boolean | undefined): void {
	if (isTraceEnabled) {
		outputChannel = outputChannel || window.createOutputChannel('Branch Breakpoints');
	}
}

function trace(value: string) {
	if (outputChannel) {
		const dateOptions = [{ year: 'numeric' }, { month: '2-digit' }, { day: '2-digit' }];
		const timeOptions = [{ hour: '2-digit', hour12: false }, { minute: '2-digit' }, { second: '2-digit' }];

		const date = new Date();
		// @ts-ignore
		const dateFormatted = dateOptions.map((option) => new Intl.DateTimeFormat('en', option).format(date)).join('-');
		// @ts-ignore
		const timeFormatted = timeOptions.map((option) => new Intl.DateTimeFormat('en', option).format(date)).join(':');
		// @ts-ignore
		const millisecondFormatted = new Intl.DateTimeFormat('en', { fractionalSecondDigits: 3 }).format(date);

		outputChannel.appendLine(`[${dateFormatted} ${timeFormatted}.${millisecondFormatted}] ${value}`);
	}
}

function getUpdatedBreakpoints(e: BreakpointsChangeEvent, isBranchLocked: boolean, branchBreakpoints: BranchBreakpoints, head: string): BranchBreakpoints | undefined {
	// If a branch is active, don't perform any operation
	if (isBranchLocked) {
		return;
	}

	const index = branchBreakpoints.branch.findIndex(x => x.name === head);

	let branch: Branch = index !== -1
		? branchBreakpoints.branch[index]
		: { name: head, breakpoints: [] };

	for (let breakpoint of e.added) {
		// Add the new breakpoint only if they don't exists yet.
		const existinBreakpoint = branch.breakpoints.find(x => areBreakpointsEqual(breakpoint, x));
		if (!existinBreakpoint) {
			branch.breakpoints.push(breakpoint);

			trace(`Added new breakpoint: ${JSON.stringify(breakpoint)}`);
		}
	}

	for (const breakpoint of e.changed) {
		const index = branch.breakpoints.findIndex(x => areBreakpointsEqual(x, breakpoint));
		branch.breakpoints.splice(index, 1);
		branch.breakpoints = [
			...branch.breakpoints.slice(0, index),
			breakpoint,
			...branch.breakpoints.slice(index + 1, branch.breakpoints.length)];

		trace(`Changed breakpoint index: ${index}`);
	}

	for (const breakpoint of e.removed) {
		const index = branch.breakpoints.findIndex(x => areBreakpointsEqual(x, breakpoint));
		branch.breakpoints.splice(index, 1);

		trace(`Removed breakpoint index: ${index}`);
	}

	const updatedBranches = [...branchBreakpoints.branch];
	if (index === -1) {
		updatedBranches.push(branch);
	} else {
		updatedBranches[index] = branch;
	}

	return {
		version: branchBreakpoints.version,
		branch: updatedBranches
	}
}

function getBreakpoint(breakpoint: JsonBreakpoint): Breakpoint {
	if (breakpoint instanceof SourceBreakpoint || breakpoint instanceof FunctionBreakpoint) {
		trace('Breakpoint already instantiated.')
		return breakpoint;
	}

	trace('Instantiate new breakpoint.')

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
		throw new Error('location or functionName has not been defined on the breakpoint.');
	}
}

function getHead(headFilename: string): string {
	return fs.readFileSync(headFilename).toString();
}

function update(context: ExtensionContext, branchBreakpoints: BranchBreakpoints): BranchBreakpoints {
	if (!branchBreakpoints.version) {
		const newVersion = '0.0.2'; // Version should match the "next" extension version.
		branchBreakpoints = clearBranchBreakpoints(context, branchBreakpoints);
		branchBreakpoints.version = newVersion

		trace(`Updated to version: ${newVersion}`);
	}

	return branchBreakpoints;
}