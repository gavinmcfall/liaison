/**
 * Fetch and parse GitHub issue templates from a repository.
 *
 * GitHub repos store issue templates as YAML files in:
 *   .github/ISSUE_TEMPLATE/*.yml (or *.yaml)
 *
 * Each template has frontmatter fields:
 *   name: "Bug Report"
 *   description: "File a bug report"
 *   title: "[Bug]: "
 *   labels: ["bug", "triage"]
 *
 * We parse these to dynamically build Discord select menus.
 */

const GITHUB_API = "https://api.github.com";

export interface IssueTemplate {
  fileName: string;
  name: string;
  description: string;
  labels: string[];
  titlePrefix: string;
}

/** Default templates used when a repo has no custom templates. */
export const DEFAULT_TEMPLATES: IssueTemplate[] = [
  {
    fileName: "_default_bug",
    name: "Bug Report",
    description: "Something isn't working correctly",
    labels: ["bug"],
    titlePrefix: "",
  },
  {
    fileName: "_default_feature",
    name: "Feature Request",
    description: "Suggest a new feature or improvement",
    labels: ["enhancement"],
    titlePrefix: "",
  },
  {
    fileName: "_default_issue",
    name: "General Issue",
    description: "Something else",
    labels: [],
    titlePrefix: "",
  },
];

/**
 * Fetch issue templates from a GitHub repository.
 * Returns parsed templates, or DEFAULT_TEMPLATES if none exist.
 */
export async function fetchIssueTemplates(
  token: string,
  owner: string,
  repo: string,
): Promise<IssueTemplate[]> {
  try {
    // List files in .github/ISSUE_TEMPLATE/
    const listResponse = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/.github/ISSUE_TEMPLATE`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Liaison-Bot",
        },
      },
    );

    if (!listResponse.ok) {
      // No templates directory — use defaults
      return DEFAULT_TEMPLATES;
    }

    const files = (await listResponse.json()) as Array<{
      name: string;
      download_url: string | null;
      type: string;
    }>;

    // Filter to .yml/.yaml files, skip config.yml
    const templateFiles = files.filter(
      (f) =>
        f.type === "file" &&
        (f.name.endsWith(".yml") || f.name.endsWith(".yaml")) &&
        f.name !== "config.yml" &&
        f.name !== "config.yaml",
    );

    if (templateFiles.length === 0) {
      return DEFAULT_TEMPLATES;
    }

    // Fetch and parse each template
    const templates: IssueTemplate[] = [];

    for (const file of templateFiles) {
      try {
        const template = await fetchAndParseTemplate(token, owner, repo, file.name);
        if (template) {
          templates.push(template);
        }
      } catch (error) {
        console.error(`Failed to parse template ${file.name}:`, error);
      }
    }

    return templates.length > 0 ? templates : DEFAULT_TEMPLATES;
  } catch (error) {
    console.error("Failed to fetch issue templates:", error);
    return DEFAULT_TEMPLATES;
  }
}

/**
 * Fetch a single template file and parse its frontmatter.
 */
async function fetchAndParseTemplate(
  token: string,
  owner: string,
  repo: string,
  fileName: string,
): Promise<IssueTemplate | null> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/.github/ISSUE_TEMPLATE/${fileName}`,
    {
      headers: {
        Accept: "application/vnd.github.raw+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Liaison-Bot",
      },
    },
  );

  if (!response.ok) return null;

  const content = await response.text();
  return parseTemplateFrontmatter(fileName, content);
}

/**
 * Parse YAML frontmatter from a GitHub issue template file.
 *
 * We use a simple regex-based parser instead of a full YAML library
 * since we only need a few top-level scalar/array fields.
 */
export function parseTemplateFrontmatter(
  fileName: string,
  content: string,
): IssueTemplate | null {
  // Extract frontmatter between --- delimiters (or just parse top-level keys)
  const lines = content.split("\n");

  let name = "";
  let description = "";
  let titlePrefix = "";
  const labels: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at 'body:' — everything after is the form definition
    if (trimmed === "body:" || trimmed.startsWith("body:")) break;

    // Match: name: "value" or name: value
    const nameMatch = trimmed.match(/^name:\s*["']?(.+?)["']?\s*$/);
    if (nameMatch) {
      name = nameMatch[1]!;
      continue;
    }

    // Match: description: "value" or description: value
    const descMatch = trimmed.match(/^description:\s*["']?(.+?)["']?\s*$/);
    if (descMatch) {
      description = descMatch[1]!;
      continue;
    }

    // Match: title: "[Bug]: " or title: value
    const titleMatch = trimmed.match(/^title:\s*["']?(.+?)["']?\s*$/);
    if (titleMatch) {
      titlePrefix = titleMatch[1]!;
      continue;
    }

    // Match labels as inline array: labels: ["bug", "triage"]
    const labelsInlineMatch = trimmed.match(/^labels:\s*\[(.+)\]/);
    if (labelsInlineMatch) {
      const raw = labelsInlineMatch[1]!;
      raw.split(",").forEach((l) => {
        const cleaned = l.trim().replace(/^["']|["']$/g, "");
        if (cleaned) labels.push(cleaned);
      });
      continue;
    }

    // Match labels as YAML list item: - "bug"
    if (labels.length > 0 || trimmed.match(/^labels:\s*$/)) {
      const listItemMatch = trimmed.match(/^-\s*["']?(.+?)["']?\s*$/);
      if (listItemMatch && !trimmed.includes(":")) {
        labels.push(listItemMatch[1]!);
      }
    }
  }

  if (!name) return null;

  return {
    fileName,
    name,
    description: description || name,
    labels,
    titlePrefix,
  };
}

/**
 * Find a specific template by filename from a list.
 */
export function findTemplate(
  templates: IssueTemplate[],
  fileName: string,
): IssueTemplate | undefined {
  return templates.find((t) => t.fileName === fileName);
}

/**
 * Pick an emoji for a template based on its name/labels.
 * Used when the repo doesn't specify one.
 */
export function guessTemplateEmoji(template: IssueTemplate): string {
  const nameLower = template.name.toLowerCase();
  const labelsLower = template.labels.map((l) => l.toLowerCase());

  if (
    nameLower.includes("bug") ||
    labelsLower.includes("bug")
  ) {
    return "\uD83D\uDC1B";
  }

  if (
    nameLower.includes("feature") ||
    nameLower.includes("enhancement") ||
    labelsLower.includes("enhancement")
  ) {
    return "\uD83D\uDCA1";
  }

  if (
    nameLower.includes("security") ||
    labelsLower.includes("security")
  ) {
    return "\uD83D\uDD12";
  }

  if (
    nameLower.includes("docs") ||
    nameLower.includes("documentation") ||
    labelsLower.includes("documentation")
  ) {
    return "\uD83D\uDCDA";
  }

  if (
    nameLower.includes("question") ||
    labelsLower.includes("question")
  ) {
    return "\u2753";
  }

  return "\uD83D\uDCCB";
}
