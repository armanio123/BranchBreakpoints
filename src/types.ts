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

export interface JsonBranchBreakpoints {
	branchName: string;
	breakpoints: JsonBreakpoint[];
}

export type VSCodeBreakpoint = SourceBreakpoint | FunctionBreakpoint | Breakpoint;