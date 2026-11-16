import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { claudeArgs, claudeCommand, createRepo, type Exec, type RunnerConfig } from "../machine.js";
import { RESULT_SCHEMA } from "../prompt.js";

const config: RunnerConfig = {
  apiUrl: "https://api.example",
  apiKey: "cliphy_sk_test",
  workUser: "cliphy-work",
  workRoot: "/srv/cliphy/work",
  reposRoot: "/srv/cliphy/repos",
};
const REPO = "example/alder-house";
const BRANCH = "cliphy/3f9a1c2e-move-the-sconces-up";
const CLONE = "/srv/cliphy/repos/example__alder-house";
const WORK = "/srv/cliphy/work/example__alder-house";
const AS_WORK = ["sudo", "-n", "-u", "cliphy-work", "-H"];

type Reply = { code?: number; stdout?: string; stderr?: string };
/** Records every command; `answer` decides what a command prints. */
function recorder(answer: (line: string) => Reply | undefined = () => undefined) {
  const lines: string[] = [];
  const exec: Exec = async (cmd, args, opts) => {
    const pipe = opts?.pipeTo ? ` | ${[opts.pipeTo[0], ...opts.pipeTo[1]].join(" ")}` : "";
    const line = [cmd, ...args].join(" ") + pipe;
    lines.push(line);
    return { code: 0, stdout: "", stderr: "", ...(answer(line) ?? {}) };
  };
  return { exec, lines };
}
const defaults = (line: string): Reply | undefined =>
  line.includes("symbolic-ref") ? { stdout: "origin/main\n" } : undefined;
const after = (argv: string[], flag: string): string => argv[argv.indexOf(flag) + 1];

describe("the runner on a real machine", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
  });

  describe("how Claude Code is started", () => {
    const args = claudeArgs();

    it("runs headless and must end with the structured answer", () => {
      expect(args).toContain("-p");
      expect(after(args, "--output-format")).toBe("json");
      expect(JSON.parse(after(args, "--json-schema"))).toEqual(RESULT_SCHEMA);
      expect(after(args, "--permission-mode")).toBe("dontAsk");
    });

    it("has only file tools and the shell, and the shell only for the project's own commands", () => {
      expect(after(args, "--tools")).toBe("Read,Edit,Write,Glob,Grep,Bash");
      const allowed = after(args, "--allowedTools").split(",");
      for (const tool of [
        "Read(./**)",
        "Edit(./**)",
        "Write(./**)",
        "Glob",
        "Grep",
        "Bash(pnpm *)",
        "Bash(npm *)",
        "Bash(yarn *)",
        "Bash(bun *)",
        "Bash(npx *)",
        "Bash(node *)",
      ]) {
        expect(allowed, tool).toContain(tool);
      }
      // Never a tool without limits: not the whole shell, not files anywhere on the machine.
      for (const tool of ["Bash", "Read", "Edit", "Write"]) expect(allowed).not.toContain(tool);
    });

    it("may not push, use GitHub or fetch from the web", () => {
      const denied = after(args, "--disallowedTools").split(",");
      for (const tool of [
        "WebFetch",
        "WebSearch",
        "Bash(git push *)",
        "Bash(gh *)",
        "Bash(curl *)",
        "Bash(wget *)",
      ]) {
        expect(denied, tool).toContain(tool);
      }
    });

    it("is run by the work user, in its own session, under a clock that kills it", () => {
      const [cmd, argv] = claudeCommand(config, 20 * 60_000);
      expect(cmd).toBe("sudo");
      expect(argv.slice(0, 4)).toEqual(["-n", "-u", "cliphy-work", "-H"]);
      expect(argv.slice(4, 10)).toEqual(["setsid", "--wait", "timeout", "-k", "10", "1200"]);
      expect(argv.slice(10)).toEqual(["claude", ...claudeArgs()]);
    });

    it("ignores settings a client's repo might carry, and takes the prompt on standard input", () => {
      // No settings files at all: not the repo's, and not ones an earlier run could have left
      // in the work user's home.
      expect(after(args, "--setting-sources")).toBe("");
      // After -p, flags and their values in pairs: no place for anything from a client.
      expect(args[0]).toBe("-p");
      expect(args.length % 2).toBe(1);
      for (let i = 1; i < args.length; i += 2) expect(args[i].startsWith("--"), args[i]).toBe(true);
    });
  });

  describe("preparing the code", () => {
    it("starts a new branch from the tip of the default branch in the runner's own clone", async () => {
      const { exec, lines } = recorder(defaults);
      expect(await createRepo(config, exec).prepare(REPO, BRANCH)).toEqual({ workDir: WORK });
      expect(lines.some((l) => l.endsWith(`-C ${CLONE} fetch origin --prune`))).toBe(true);
      expect(lines.some((l) => l.endsWith(`checkout -f -B ${BRANCH} origin/main`))).toBe(true);
      expect(lines.some((l) => l.includes("gh repo clone"))).toBe(false);
    });

    it("clones the repo the first time", async () => {
      const { exec, lines } = recorder((line) =>
        line.includes("rev-parse") ? { code: 128 } : defaults(line),
      );
      await createRepo(config, exec).prepare(REPO, BRANCH);
      expect(lines).toContain(`gh repo clone ${REPO} ${CLONE}`);
    });

    it("gives Claude a copy with no git history, unpacked by the work user from a pipe", async () => {
      const { exec, lines } = recorder(defaults);
      await createRepo(config, exec).prepare(REPO, BRANCH);
      const copy = lines.find((l) => l.includes(" | "))!;
      const [from, to] = copy.split(" | ");
      // The runner reads its own clone; the work user never reads the runner's folders.
      expect(from).toBe(`tar -C ${CLONE} --exclude=./.git -cf - .`);
      expect(to).toBe(`${AS_WORK.join(" ")} tar -x -C ${WORK}`);
      expect(lines.some((l) => l.startsWith(AS_WORK.join(" ")) && l.includes(CLONE))).toBe(false);
    });

    it("clears away whatever an earlier run left running or lying in the work user's home", async () => {
      const { exec, lines } = recorder(defaults);
      await createRepo(config, exec).prepare(REPO, BRANCH);
      const kill = lines.indexOf(`${AS_WORK.join(" ")} pkill -KILL -u cliphy-work`);
      const copy = lines.findIndex((l) => l.includes(" | "));
      expect(kill).toBeGreaterThan(-1);
      expect(kill).toBeLessThan(copy);
      const wipe = lines.find(
        (l) => l.includes(" rm -rf ") && l.includes(".claude/settings.json"),
      )!;
      for (const left of [".claude/settings.json", ".claude/CLAUDE.md", ".npmrc", ".yarnrc.yml"]) {
        expect(wipe, left).toContain(`/home/cliphy-work/${left}`);
      }
    });

    it("puts the client's pictures in the work folder, fetched by the work user", async () => {
      const { exec, lines } = recorder((l) => (l.includes("b.jpg") ? { code: 22 } : undefined));
      const files = await createRepo(config, exec).attach(REPO, [
        "https://signed.example/a.png?token=1",
        "https://signed.example/b.jpg?token=2",
        "http://insecure.example/c.png",
        "-o/etc/passwd",
      ]);
      expect(files).toEqual([".cliphy-brief/1.png"]); // One failed, two were not https addresses.
      const fetches = lines.filter((l) => l.includes(" curl "));
      expect(fetches).toHaveLength(2);
      for (const f of fetches) {
        expect(f.startsWith(AS_WORK.join(" "))).toBe(true);
        expect(f).toContain(`${WORK}/.cliphy-brief/`);
        expect(f).toContain("--proto =https");
      }
    });

    it("refuses a repo or branch that is not the shape it expects, before running anything", async () => {
      const { exec, lines } = recorder(defaults);
      const repo = createRepo(config, exec);
      await expect(repo.prepare("example/alder-house; rm -rf /", BRANCH)).rejects.toThrow();
      await expect(repo.prepare("../etc", BRANCH)).rejects.toThrow();
      await expect(repo.prepare(REPO, "main")).rejects.toThrow();
      await expect(repo.prepare(REPO, "cliphy/../main")).rejects.toThrow();
      expect(lines).toEqual([]);
    });

    it("stops when a step fails", async () => {
      const { exec } = recorder((line) =>
        line.includes("fetch") ? { code: 1, stderr: "no network" } : defaults(line),
      );
      await expect(createRepo(config, exec).prepare(REPO, BRANCH)).rejects.toThrow(/fetch/);
    });
  });

  describe("bringing the changes back", () => {
    it("copies files only: never git data, dependencies, the brief, or links that point outside", async () => {
      const { exec, lines } = recorder((line) =>
        line.includes("status --porcelain") ? { stdout: " M index.html\n" } : undefined,
      );
      expect(await createRepo(config, exec).collect(REPO)).toEqual({ changed: true });
      const copy = lines.find((l) => l.includes("rsync"))!;
      expect(copy.startsWith("rsync ")).toBe(true); // As the runner, not the work user.
      for (const flag of [
        "--delete",
        "--exclude .git",
        "--exclude node_modules",
        "--exclude .cliphy-brief",
        "--safe-links",
      ]) {
        expect(copy, flag).toContain(flag);
      }
      expect(copy.endsWith(`${WORK}/ ${CLONE}/`)).toBe(true);
    });

    it("never copies a file's owner, special permission bits or devices", async () => {
      const { exec, lines } = recorder();
      await createRepo(config, exec).collect(REPO);
      const argv = lines.find((l) => l.startsWith("rsync "))!.split(" ");
      // -a would carry setuid bits and device files into a folder the runner owns.
      expect(argv).not.toContain("-a");
      expect(argv.some((a) => /^-[a-z]*[apDgo]/.test(a) && !a.startsWith("--"))).toBe(false);
      expect(argv).toContain("-rlt");
      expect(argv).toContain("--executability");
      expect(argv).toContain("--chmod=ug-s,o-w");
    });

    it("stops everything the work user still has running before it reads the files", async () => {
      const { exec, lines } = recorder();
      await createRepo(config, exec).collect(REPO);
      const kill = lines.indexOf(`${AS_WORK.join(" ")} pkill -KILL -u cliphy-work`);
      expect(kill).toBeGreaterThan(-1);
      expect(kill).toBeLessThan(lines.findIndex((l) => l.startsWith("rsync ")));
    });

    it("says nothing changed when git sees no difference", async () => {
      const { exec } = recorder();
      expect(await createRepo(config, exec).collect(REPO)).toEqual({ changed: false });
    });
  });

  describe("publishing", () => {
    const prUrl = "https://github.com/example/alder-house/pull/3";
    const publish = (answer: (line: string) => Reply | undefined) => {
      const r = recorder(answer);
      const done = createRepo(config, r.exec).publish(REPO, BRANCH, "Move the sconces up", "Body");
      return { ...r, done };
    };

    it("commits with hooks off, pushes only its own branch and opens a draft pull request", async () => {
      const { lines, done } = publish((l) =>
        l.startsWith("gh pr") ? { stdout: `${prUrl}\n` } : undefined,
      );
      expect(await done).toEqual({ prUrl });
      const commit = lines.find((l) => l.includes(" commit "))!;
      expect(commit).toContain("-c core.hooksPath=/dev/null");
      expect(commit).toContain("-c core.fsmonitor=false");
      expect(lines).toContain(
        `git -c core.hooksPath=/dev/null -c core.fsmonitor=false -C ${CLONE} push origin HEAD:refs/heads/${BRANCH}`,
      );
      const pr = lines.find((l) => l.startsWith("gh pr create"))!;
      expect(pr).toContain("--draft");
      expect(pr).toContain(`--repo ${REPO}`);
      expect(pr).toContain(`--head ${BRANCH}`);
    });

    it("opens an ordinary pull request where the repo's plan has no drafts", async () => {
      const { lines, done } = publish((l) => {
        if (!l.startsWith("gh pr")) return undefined;
        return l.includes("--draft")
          ? { code: 1, stderr: "Draft pull requests are not supported in this repository." }
          : { stdout: `${prUrl}\n` };
      });
      expect(await done).toEqual({ prUrl });
      expect(lines.filter((l) => l.startsWith("gh pr create"))).toHaveLength(2);
    });

    it("never pushes a branch that is not cliphy/…", async () => {
      const { exec, lines } = recorder();
      await expect(createRepo(config, exec).publish(REPO, "main", "t", "b")).rejects.toThrow();
      expect(lines).toEqual([]);
    });

    it("fails when GitHub does not answer with a pull request address, saying the branch is up", async () => {
      const { done } = publish((l) => (l.startsWith("gh pr") ? { stdout: "ok" } : undefined));
      await expect(done).rejects.toMatchObject({ pushed: true });
    });

    it("fails without a branch when the push itself failed", async () => {
      const { done } = publish((l) => (l.includes(" push ") ? { code: 1 } : undefined));
      await expect(done).rejects.not.toHaveProperty("pushed", true);
    });
  });

  it("runs nothing of git or GitHub as the work user, and nothing in the work folder as itself", async () => {
    const { exec, lines } = recorder((l) =>
      l.includes("symbolic-ref")
        ? { stdout: "origin/main\n" }
        : l.startsWith("gh pr")
          ? { stdout: "https://github.com/example/alder-house/pull/3\n" }
          : undefined,
    );
    const repo = createRepo(config, exec);
    await repo.prepare(REPO, BRANCH);
    await repo.collect(REPO);
    await repo.publish(REPO, BRANCH, "t", "b");
    await repo.discard(REPO);
    for (const line of lines) {
      const asWork = line.startsWith(AS_WORK.join(" "));
      if (/(^| )(git|gh) /.test(line)) expect(asWork, line).toBe(false);
      // Only the copy back reads the work folder as the runner; nothing there is run.
      if (line.includes(WORK) && !asWork && !line.includes(" | ")) {
        expect(line.startsWith("rsync "), line).toBe(true);
      }
    }
    expect(lines).toContain(`${AS_WORK.join(" ")} rm -rf ${WORK}`);
    expect(lines.at(-1)).toBe(`${AS_WORK.join(" ")} pkill -KILL -u cliphy-work`);
  });
});
