export function getProjects() {
  return fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/projects`);
}

export function getMembers(project: string) {
  return fetch(`${process.env.APP_PATH_PREFIX ?? ""}/api/projects/${project}/members`);
}

// a base URL, not a path: the env var stays the host
export function getBilling() {
  return fetch(`${process.env.BILLING_API_URL}/v1/invoices`);
}
