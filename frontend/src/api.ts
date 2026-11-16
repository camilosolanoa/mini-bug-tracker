export const statuses = ['Open', 'In Progress', 'Ready for QA', 'Done'] as const;
export const severities = ['Low', 'Medium', 'High', 'Critical'] as const;
export type Status = typeof statuses[number];

export type Bug = {
  id: number;
  title: string;
  description: string;
  severity: typeof severities[number];
  assignee: string | null;
  status: Status;
  allowed_transitions: Status[];
};

type ValidationError = { loc: (string | number)[]; msg: string };

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail: string | ValidationError[] | undefined = body?.detail;
    const message = typeof detail === 'string' ? detail
      : Array.isArray(detail) ? detail.map(e => `${e.loc.at(-1)}: ${e.msg}`).join('. ')
      : 'Request failed. Check that the backend is running and try again.';
    throw new Error(message);
  }
  return response.json();
}

export function jsonBody(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
