import type { SourceBreakpoint, FunctionBreakpoint, Breakpoint } from "vscode";

export interface JsonBreakpoint {
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

export interface JsonBranchBreakpoints {
	branchName: string;
	breakpoints: JsonBreakpoint[];
}

export interface BranchBreakpoints {
	branchName: string;
	breakpoints: (SourceBreakpoint | FunctionBreakpoint | Breakpoint)[];
}