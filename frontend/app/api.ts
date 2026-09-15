const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://ynex3.mycafe24.com/api";

export interface User {
  id: number;
  name: string;
  phone: string;
  created_at: string;
}

export interface Payment {
  id: number;
  user_id: number;
  due_date: string;
  amount: number;
  memo: string;
  is_paid: boolean;
  sms_sent: boolean;
  created_at: string;
  user: User;
}

export interface SmsLogEntry {
  id: number;
  user_name: string;
  phone: string;
  message: string;
  status: string;
  error: string;
  sent_at: string;
}

export interface Dashboard {
  year: number;
  month: number;
  total_count: number;
  total_amount: number;
  paid_count: number;
  paid_amount: number;
  unpaid_count: number;
  unpaid_amount: number;
  sms_sent_count: number;
  today_count: number;
  today_amount: number;
  user_count: number;
  recent_logs: { user_name: string; status: string; sent_at: string }[];
}

// === Auth ===

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("payflow_token");
}

export function setToken(token: string) {
  localStorage.setItem("payflow_token", token);
}

export function clearToken() {
  localStorage.removeItem("payflow_token");
}

async function request(path: string, options?: RequestInit) {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.reload();
    throw new Error("인증이 만료되었습니다. 다시 로그인하세요.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "요청 실패");
  }
  return res.json();
}

export const auth = {
  login: (password: string): Promise<{ token: string }> =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  verify: (): Promise<{ valid: boolean }> => request("/auth/verify"),
};

export const api = {
  getUsers: (): Promise<User[]> => request("/users"),
  createUser: (data: { name: string; phone: string }): Promise<User> =>
    request("/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: number, data: { name: string; phone: string }): Promise<User> =>
    request(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id: number) =>
    request(`/users/${id}`, { method: "DELETE" }),

  getPayments: (year?: number, month?: number): Promise<Payment[]> => {
    const params = year && month ? `?year=${year}&month=${month}` : "";
    return request(`/payments${params}`);
  },
  createPayment: (data: { user_id: number; due_date: string; amount: number; memo: string }): Promise<Payment> =>
    request("/payments", { method: "POST", body: JSON.stringify(data) }),
  updatePayment: (id: number, data: Partial<{ is_paid: boolean; due_date: string; amount: number; memo: string }>): Promise<Payment> =>
    request(`/payments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePayment: (id: number) =>
    request(`/payments/${id}`, { method: "DELETE" }),

  sendSMS: (paymentId: number, message?: string) =>
    request("/sms/send", { method: "POST", body: JSON.stringify({ payment_id: paymentId, message }) }),
  sendBulkSMS: () =>
    request("/sms/send-bulk", { method: "POST" }),

  getDashboard: (year?: number, month?: number): Promise<Dashboard> => {
    const params = year && month ? `?year=${year}&month=${month}` : "";
    return request(`/dashboard${params}`);
  },
  getSmsLogs: (page: number = 1): Promise<{ total: number; page: number; logs: SmsLogEntry[] }> =>
    request(`/sms/logs?page=${page}`),

  getSendTime: (): Promise<{ send_time: string }> =>
    request("/settings/send-time"),
  setSendTime: (send_time: string) =>
    request("/settings/send-time", { method: "PUT", body: JSON.stringify({ send_time }) }),

  getExcelUrl: (year: number, month: number) => {
    const token = getToken();
    return `${API_BASE}/export/excel?year=${year}&month=${month}${token ? `&token=${token}` : ""}`;
  },
};
