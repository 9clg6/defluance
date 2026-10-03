/** The commands and settings that connect an agent to this server. The token is always a placeholder: it is shown once, at creation. */
export const TOKEN_PLACEHOLDER = "<YOUR_TOKEN>";

export function mcpSnippets(url: string) {
  return {
    claude: `claude mcp add --transport http defluance ${url} --header "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
    json: JSON.stringify({ mcpServers: { defluance: { url, headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` } } } }, null, 2),
    stdio: "claude mcp add defluance -- npx defluance mcp ./my-notes",
  };
}
