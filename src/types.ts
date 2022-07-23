import type { SourceBreakpoint, FunctionBreakpoint, Breakpoint } from "vscode";

export interface JsonBreakpoint extends Breakpoint {
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

export interface BranchBreakpoints {
	version: string;
	branch: Branch[]
}

export type VSCodeBreakpoint = SourceBreakpoint | FunctionBreakpoint | Breakpoint;

export type Branch = {
	name: string;
	breakpoints: JsonBreakpoint[];
}

export function isSourceBreakpoint(breakpoint: VSCodeBreakpoint): breakpoint is SourceBreakpoint {
	return (breakpoint as SourceBreakpoint).location !== undefined;
}

export function isFunctionBreakpoint(breakpoint: VSCodeBreakpoint): breakpoint is FunctionBreakpoint {
	return (breakpoint as FunctionBreakpoint).functionName !== undefined;
}

export function areBreakpointsEqual(breakpoint1: VSCodeBreakpoint, breakpoint2: VSCodeBreakpoint): boolean {
	return isSourceBreakpoint(breakpoint1) && isSourceBreakpoint(breakpoint2) && breakpoint1.location.uri.path === breakpoint2.location.uri.path && breakpoint1.location.range.isEqual(breakpoint2.location.range)
		|| isFunctionBreakpoint(breakpoint1) && isFunctionBreakpoint(breakpoint2) && breakpoint1.functionName === breakpoint2.functionName;
}