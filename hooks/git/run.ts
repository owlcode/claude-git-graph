export type RunResult = { exitCode: number; stdout: string; stderr: string }

/** Runs `argv` (git and its arguments) in `cwd`; the mod binds this to `$.process.run`. */
export type Run = (argv: readonly string[], cwd: string) => Promise<RunResult>
