import { describe, expect, it } from "vitest";
import { parseGitHubRemote } from "../src/detect.js";
import { formulaClassName, render } from "../src/templates.js";

describe("render", () => {
  const template = "a\n# >>> x\nx {{V}}\n  # >>> y\n  y\n  # <<< y\n# <<< x\nz ${{ github.ref }}\n";

  it("keeps enabled blocks, including nested ones", () => {
    expect(render(template, { V: "1" }, ["x", "y"])).toBe("a\nx 1\n  y\nz ${{ github.ref }}\n");
  });

  it("removes disabled blocks and leaves GitHub expressions alone", () => {
    expect(render(template, { V: "1" }, [])).toBe("a\nz ${{ github.ref }}\n");
    expect(render(template, { V: "1" }, ["x"])).toBe("a\nx 1\nz ${{ github.ref }}\n");
  });

  it("fails loudly on a missing variable", () => {
    expect(() => render("{{NOPE}}", {})).toThrow(/NOPE/);
  });
});

describe("helpers", () => {
  it("parses GitHub remotes", () => {
    expect(parseGitHubRemote("git@github.com:Acme/widget.git")).toEqual({ owner: "Acme", repo: "widget" });
    expect(parseGitHubRemote("https://github.com/acme/widget")).toEqual({ owner: "acme", repo: "widget" });
    expect(parseGitHubRemote("git+https://github.com/acme/widget.git")).toEqual({ owner: "acme", repo: "widget" });
    expect(parseGitHubRemote("https://gitlab.com/acme/widget")).toBeUndefined();
  });

  it("builds Homebrew class names", () => {
    expect(formulaClassName("packnpub")).toBe("Packnpub");
    expect(formulaClassName("my-cool_tool")).toBe("MyCoolTool");
  });
});
