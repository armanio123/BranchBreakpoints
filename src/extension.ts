import { Breakpoint, BreakpointsChangeEvent, commands, debug as vscodeDebug, ExtensionContext, FunctionBreakpoint, Location, OutputChannel, Position, Range, SourceBreakpoint, Uri, window, workspace } from 'vscode';
import * as fs from 'fs';
import { JsonBranchBreakpoints, JsonBreakpoint, VSCodeBreakpoint } from './types';

const breakpointMapKeyName = 'breakpointMap';
const configurationSection = 'branchBreakpoints';
const traceConfiguration = 'trace';

let outputChannel: OutputChannel | undefined;

export function activate(context: ExtensionContext) {
	createOutputChannel(workspace.getConfiguration(configurationSection).get(traceConfiguration));
	trace('Extension activated');

	let branchBreakpoints = context.workspaceState.get<JsonBranchBreakpoints[]>(breakpointMapKeyName) || [];
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
		branchBreakpoints = [];
		context.workspaceState.update(breakpointMapKeyName, undefined);
		trace(`Map cleared`);
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

		const branchBreakpoint = branchBreakpoints.find(value => value.branchName === head);
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

function isSourceBreakpoint(breakpoint: VSCodeBreakpoint): breakpoint is SourceBreakpoint {
	return (breakpoint as SourceBreakpoint).location !== undefined;
}

function isFunctionBreakpoint(breakpoint: VSCodeBreakpoint): breakpoint is FunctionBreakpoint {
	return (breakpoint as FunctionBreakpoint).functionName !== undefined;
}

function areBreakpointsEqual(breakpoint1: VSCodeBreakpoint, breakpoint2: VSCodeBreakpoint): boolean {
	return isSourceBreakpoint(breakpoint1) && isSourceBreakpoint(breakpoint2) && breakpoint1.location.uri.path === breakpoint2.location.uri.path && breakpoint1.location.range.isEqual(breakpoint2.location.range)
		|| isFunctionBreakpoint(breakpoint1) && isFunctionBreakpoint(breakpoint2) && breakpoint1.functionName === breakpoint2.functionName;
}

function getUpdatedBreakpoints(e: BreakpointsChangeEvent, isBranchLocked: boolean, branchBreakpoints: JsonBranchBreakpoints[], head: string): JsonBranchBreakpoints[] | undefined {
	// If a branch is active, don't perform any operation
	if (isBranchLocked) {
		return;
	}

	const index = branchBreakpoints.findIndex(value => value.branchName === head);

	let branchBreakpoint = index !== -1
		? branchBreakpoints[index]
		: { branchName: head, breakpoints: [] };

	for (let breakpoint of e.added) {
		// Add the new breakpoint only if they don't exists yet.
		const existinBreakpoint = branchBreakpoint.breakpoints.find(x => areBreakpointsEqual(breakpoint, x));
		if (!existinBreakpoint) {
			branchBreakpoint.breakpoints.push(breakpoint);

			trace(`Added new breakpoint: ${JSON.stringify(breakpoint)}`);
		}
	}

	for (const breakpoint of e.changed) {
		const index = branchBreakpoint.breakpoints.findIndex(x => areBreakpointsEqual(x, breakpoint));
		branchBreakpoint.breakpoints.splice(index, 1);
		branchBreakpoint.breakpoints = [
			...branchBreakpoint.breakpoints.slice(0, index),
			breakpoint,
			...branchBreakpoint.breakpoints.slice(index + 1, branchBreakpoint.breakpoints.length)];

		trace(`Changed breakpoint index: ${index}`);
	}

	for (const breakpoint of e.removed) {
		const index = branchBreakpoint.breakpoints.findIndex(x => areBreakpointsEqual(x, breakpoint));
		branchBreakpoint.breakpoints.splice(index, 1);

		trace(`Removed breakpoint index: ${index}`);
	}

	const updateBreakpoints = [...branchBreakpoints];
	if (index === -1) {
		updateBreakpoints.push(branchBreakpoint);
	} else {
		updateBreakpoints[index] = branchBreakpoint;
	}

	return updateBreakpoints;
}

function getBreakpoint(breakpoint: JsonBreakpoint): Breakpoint {
	if (breakpoint instanceof SourceBreakpoint || breakpoint instanceof FunctionBreakpoint) {
		trace ('Breakpoint already instantiated.')
		return breakpoint;
	}

	trace ('Instantiate new breakpoint.')

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

export function deactivate() { }
