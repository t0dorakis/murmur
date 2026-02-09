import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "./frontmatter.ts";
import githubDigestTpl from "./templates/github-digest.md" with { type: "text" };

const TEMPLATES: Record<string, string> = {
  "github-digest": githubDigestTpl,
};

describe("starter templates", () => {
  for (const [name, content] of Object.entries(TEMPLATES)) {
    describe(name, () => {
      test("has valid frontmatter with required fields", () => {
        const { metadata } = parseFrontmatter(content);
        expect(metadata.name).toBeString();
        expect(metadata.description).toBeString();
        expect(metadata.interval || metadata.cron).toBeTruthy();
      });

      test("has non-empty body", () => {
        const { content: body } = parseFrontmatter(content);
        expect(body.trim().length).toBeGreaterThan(0);
      });
    });
  }
});
