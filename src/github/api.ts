const GITHUB_API = "https://api.github.com";

interface CreateIssueParams {
  token: string;
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
}

interface GitHubIssueResponse {
  number: number;
  html_url: string;
  title: string;
  state: string;
}

/**
 * Create a GitHub issue using an installation access token.
 */
export async function createIssue(
  params: CreateIssueParams,
): Promise<GitHubIssueResponse> {
  const { token, owner, repo, title, body, labels } = params;

  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Liaison-Bot",
    },
    body: JSON.stringify({ title, body, labels }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${error}`);
  }

  return response.json() as Promise<GitHubIssueResponse>;
}

/**
 * Add a comment to a GitHub issue.
 */
export async function addIssueComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Liaison-Bot",
      },
      body: JSON.stringify({ body }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${error}`);
  }
}

/**
 * Get a GitHub App installation for a specific repository.
 * Returns the installation ID if the App is installed on the repo.
 */
export async function getRepoInstallation(
  jwt: string,
  owner: string,
  repo: string,
): Promise<{ id: number } | null> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/installation`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Liaison-Bot",
      },
    },
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${error}`);
  }

  return response.json() as Promise<{ id: number }>;
}

/**
 * List repositories accessible to a GitHub App installation.
 */
export async function listInstallationRepos(
  token: string,
): Promise<Array<{ full_name: string; name: string; owner: { login: string } }>> {
  const response = await fetch(`${GITHUB_API}/installation/repositories`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Liaison-Bot",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    repositories: Array<{
      full_name: string;
      name: string;
      owner: { login: string };
    }>;
  };
  return data.repositories;
}
