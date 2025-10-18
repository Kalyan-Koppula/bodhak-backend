const GH_API = (env: Env) =>
  `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/contents`;

const fetchOptions = (env: Env, method: string, body?: any) => ({
  method,
  headers: {
    Authorization: `token ${env.GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  },
  body: body ? JSON.stringify(body) : undefined,
});

// Creates a file in the GitHub repository
export const createGitHubFile = async (
  env: Env,
  filePath: string,
  content: string,
  message: string
) => {
  const url = `${GH_API(env)}/${filePath}`;

  const response = await fetch(
    url,
    fetchOptions(env, 'PUT', {
      message,
      content: btoa(content), // Base64 encode the content
    })
  );

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(
      `Failed to create file on GitHub: ${response.status} - ${JSON.stringify(errorBody)}`
    );
  }
  return response.json();
};

// Gets file details (SHA) for updating/deleting
export const getFileSha = async (env: Env, filePath: string) => {
  const url = `${GH_API(env)}/${filePath}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch file SHA from GitHub: ${response.status}`);
  }

  const data: any = await response.json();
  return data?.sha as string | undefined;
};

// Updates a file in the GitHub repository
export const updateGitHubFile = async (
  env: Env,
  filePath: string,
  content: string,
  message: string,
  sha: string
) => {
  const url = `${GH_API(env)}/${filePath}`;

  const response = await fetch(
    url,
    fetchOptions(env, 'PUT', {
      message,
      content: btoa(content),
      sha, // SHA is required for updates
    })
  );

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(
      `Failed to update file on GitHub: ${response.status} - ${JSON.stringify(errorBody)}`
    );
  }
  return response.json();
};

// Deletes a file from the GitHub repository
export const deleteGitHubFile = async (
  env: Env,
  filePath: string,
  sha: string,
  message: string
) => {
  const url = `${GH_API(env)}/${filePath}`;

  const response = await fetch(
    url,
    fetchOptions(env, 'DELETE', {
      message,
      sha, // SHA is required to delete a file
    })
  );

  if (!response.ok) {
    const errorBody = await response.json();
    throw new Error(
      `Failed to delete file on GitHub: ${response.status} - ${JSON.stringify(errorBody)}`
    );
  }
};
