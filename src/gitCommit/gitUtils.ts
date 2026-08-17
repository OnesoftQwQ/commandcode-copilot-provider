import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const GIT_OUTPUT_LINE_LIMIT = 500;
const GIT_LOG_FORMAT = "--format=%H%n%h%n%s%n%an%n%ad";

export interface GitCommit {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
}

async function checkGitRepo(cwd: string): Promise<boolean> {
    try {
        await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd });
        return true;
    } catch {
        return false;
    }
}

async function checkGitInstalled(): Promise<boolean> {
    try {
        await execFileAsync("git", ["--version"]);
        return true;
    } catch {
        return false;
    }
}

async function checkGitRepoHasCommits(cwd: string): Promise<boolean> {
    try {
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
        return true;
    } catch {
        return false;
    }
}

export async function searchCommits(query: string, cwd: string): Promise<GitCommit[]> {
    try {
        const isInstalled = await checkGitInstalled();
        if (!isInstalled) {
            console.error("Git is not installed");
            return [];
        }

        const isRepo = await checkGitRepo(cwd);
        if (!isRepo) {
            console.error("Not a git repository");
            return [];
        }

        if (!(await checkGitRepoHasCommits(cwd))) {
            return [];
        }

        const { stdout } = await execFileAsync("git", [
            "log",
            "-n",
            "10",
            GIT_LOG_FORMAT,
            "--date=short",
            "--grep",
            query,
            "--regexp-ignore-case",
        ], { cwd });

        let output = stdout;
        if (!output.trim() && /^[a-f0-9]+$/i.test(query)) {
            const { stdout: hashStdout } = await execFileAsync("git", [
                "log",
                "-n",
                "10",
                GIT_LOG_FORMAT,
                "--date=short",
                "--author-date-order",
                query,
            ], { cwd }).catch(() => ({ stdout: "" }));

            if (!hashStdout.trim()) {
                return [];
            }

            output = hashStdout;
        }

        if (!output.trim()) {
            return [];
        }

        const lines = output.trim().split("\n");
        const commits: GitCommit[] = [];
        for (let i = 0; i + 4 < lines.length; i += 5) {
            commits.push({
                hash: lines[i].trim(),
                shortHash: lines[i + 1].trim(),
                subject: lines[i + 2].trim(),
                author: lines[i + 3].trim(),
                date: lines[i + 4].trim(),
            });
        }
        return commits;
    } catch (error) {
        console.error("Error searching commits:", error);
        return [];
    }
}

export async function getGitDiff(repoPath: string): Promise<string | undefined> {
    try {
        const isInstalled = await checkGitInstalled();
        if (!isInstalled) {
            console.error("Git is not installed");
            return undefined;
        }

        const isRepo = await checkGitRepo(repoPath);
        if (!isRepo) {
            console.error("Not a git repository");
            return undefined;
        }

        // Get staged diff (what will be committed)
        // Use -U1 to minimize context lines, keeping diffs compact and avoiding
        // inclusion of unchanged content between separate change sections
        const { stdout } = await execFileAsync("git", ["diff", "--cached", "-U1", "--", "."], {
            cwd: repoPath,
            maxBuffer: 10 * 1024 * 1024,
        });

        if (stdout.trim()) {
            return limitDiffLines(stdout.trim(), GIT_OUTPUT_LINE_LIMIT);
        }

        // Fall back to unstaged diff
        const { stdout: unstagedStdout } = await execFileAsync("git", ["diff", "-U1", "--", "."], {
            cwd: repoPath,
            maxBuffer: 10 * 1024 * 1024,
        });

        if (unstagedStdout.trim()) {
            return limitDiffLines(unstagedStdout.trim(), GIT_OUTPUT_LINE_LIMIT);
        }

        return undefined;
    } catch (error) {
        console.error("Error getting git diff:", error);
        return undefined;
    }
}

export interface GetRecentCommitsOptions {
    /** Whether to include the actual diff of each commit (default: false) */
    includeDiff?: boolean;
    /** Max diff lines per commit when includeDiff is true (default: 50) */
    maxDiffLinesPerCommit?: number;
}

/**
 * Fetch recent commit subjects to use as style reference.
 * @param repoPath Repository path
 * @param count Number of recent commits to fetch
 * @param options Optional settings for including commit diffs
 * @returns Concatenated commit subjects (and diffs if enabled), one per line
 */
export async function getRecentCommits(repoPath: string, count: number, options?: GetRecentCommitsOptions): Promise<string> {
    if (count <= 0) {
        return "";
    }
    try {
        const isInstalled = await checkGitInstalled();
        if (!isInstalled) {
            return "";
        }
        const isRepo = await checkGitRepo(repoPath);
        if (!isRepo) {
            return "";
        }
        if (!(await checkGitRepoHasCommits(repoPath))) {
            return "";
        }

        const includeDiff = options?.includeDiff ?? false;
        const maxDiffLinesPerCommit = options?.maxDiffLinesPerCommit ?? 50;

        if (includeDiff) {
            // Fetch full commit log with hash and subject
            const { stdout: logStdout } = await execFileAsync("git", [
                "log",
                `-n ${count}`,
                "--format=%H%n%s",
                "--no-merges",
            ], { cwd: repoPath, maxBuffer: 1024 * 1024 });

            if (!logStdout.trim()) {
                return "";
            }

            const lines = logStdout.trim().split("\n");
            const results: string[] = [];

            for (let i = 0; i + 1 < lines.length; i += 2) {
                const hash = lines[i].trim();
                const subject = lines[i + 1].trim();

                let entry = `Commit: ${subject}`;

                if (hash) {
                    try {
                        // Use -U1 to minimize context, keeping the diff focused
                        // on actual changed lines rather than surrounding context
                        const { stdout: diffOut } = await execFileAsync("git", [
                            "show",
                            hash,
                            "--format=", // no commit metadata in diff
                            "-U1",
                            "--",
                            ".",
                        ], { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 });

                        if (diffOut.trim()) {
                            entry += "\nChanges:\n" + limitDiffLines(diffOut.trim(), maxDiffLinesPerCommit);
                        }
                    } catch {
                        // If git show fails for this commit, skip its diff
                    }
                }

                results.push(entry);
            }

            return results.join("\n\n");
        }

        // Original behavior: only subjects
        const { stdout } = await execFileAsync("git", [
            "log",
            `-n ${count}`,
            "--format=%s",
            "--no-merges",
        ], { cwd: repoPath, maxBuffer: 1024 * 1024 });
        return stdout.trim();
    } catch {
        return "";
    }
}

function limitDiffLines(diff: string, maxLines: number): string {
    const lines = diff.split("\n");
    if (lines.length <= maxLines) {
        return diff;
    }
    return lines.slice(0, maxLines).join("\n") + `\n\n[Diff truncated: ${lines.length - maxLines} lines omitted]`;
}
