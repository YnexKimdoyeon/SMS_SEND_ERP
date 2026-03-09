"use client";

import { useState, useEffect, useCallback } from "react";
import { api, User, Payment, Dashboard, SmsLogEntry } from "./api";

const DEFAULT_TEMPLATE =
  "[입금 안내] {이름}님, {입금일} 입금 예정일입니다. 금액: {금액}원{메모}";

function formatPhone(phone: string) {
  const p = phone.replace(/\D/g, "");
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
  if (p.length === 10) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
  return phone;
}

function formatAmount(n: number) {
  return n.toLocaleString("ko-KR");
}

function buildMessage(template: string, p: Payment) {
  return template
    .replace("{이름}", p.user.name)
    .replace("{입금일}", p.due_date.replace(/-/g, "."))
    .replace("{금액}", formatAmount(p.amount))
    .replace("{메모}", p.memo ? ` (${p.memo})` : "");
}

// === Icons ===
const icons = {
  dashboard: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" /></svg>,
  calendar: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  users: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2m8-10a4 4 0 100-8 4 4 0 000 8zm10 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>,
  logs: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
  settings: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  send: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>,
  download: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  chevron: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>,
};

// === Calendar ===
function Calendar({
  year, month, payments, selectedDate, onSelectDate,
}: {
  year: number; month: number; payments: Payment[];
  selectedDate: string | null; onSelectDate: (d: string) => void;
}) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const todayDay = today.getFullYear() === year && today.getMonth() + 1 === month ? today.getDate() : -1;

  const byDay: Record<number, Payment[]> = {};
  for (const p of payments) {
    const d = parseInt(p.due_date.split("-")[2], 10);
    (byDay[d] ||= []).push(p);
  }

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} className="h-24" />);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const list = byDay[d] || [];
    const isToday = d === todayDay;
    const isSelected = selectedDate === dateStr;

    cells.push(
      <div
        key={d}
        onClick={() => onSelectDate(dateStr)}
        className={`h-24 p-1.5 cursor-pointer transition-all relative group
          ${isSelected ? "bg-indigo-50 ring-2 ring-indigo-400" : "hover:bg-slate-50"}
          ${isToday ? "bg-blue-50/50" : ""}`}
      >
        <div className={`text-xs font-semibold mb-1 flex items-center justify-center w-6 h-6 rounded-full
          ${isToday ? "bg-indigo-600 text-white" : "text-slate-500 group-hover:text-slate-700"}`}>
          {d}
        </div>
        <div className="space-y-0.5 overflow-hidden">
          {list.slice(0, 2).map((p) => (
            <div key={p.id}
              className={`text-[10px] leading-tight rounded-md px-1.5 py-0.5 truncate font-medium
                ${p.is_paid ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}
            >
              {p.user.name} {formatAmount(p.amount)}
            </div>
          ))}
          {list.length > 2 && (
            <div className="text-[10px] text-slate-400 pl-1">+{list.length - 2}건</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
        {["일", "월", "화", "수", "목", "금", "토"].map((x, i) => (
          <div key={x} className={`text-center text-[11px] font-bold py-2.5 tracking-wider
            ${i === 0 ? "text-rose-400" : i === 6 ? "text-blue-400" : "text-slate-400"}`}>{x}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">{cells}</div>
    </div>
  );
}

// === Stat Card ===
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  const colors: Record<string, string> = {
    blue: "from-blue-500 to-blue-600",
    orange: "from-amber-500 to-orange-600",
    green: "from-emerald-500 to-emerald-600",
    red: "from-rose-500 to-rose-600",
    purple: "from-violet-500 to-violet-600",
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} rounded-2xl p-5 text-white`}>
      <div className="text-sm font-medium opacity-90">{label}</div>
      <div className="text-3xl font-extrabold mt-1 tracking-tight">{value}</div>
      {sub && <div className="text-sm opacity-75 mt-1">{sub}</div>}
    </div>
  );
}

type Tab = "dashboard" | "calendar" | "users" | "logs" | "settings";

// === Main ===
export default function Home() {
  const [users, setUsers] = useState<User[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");

  const [userName, setUserName] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);

  const [payDate, setPayDate] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMemo, setPayMemo] = useState("");

  const [smsTemplate, setSmsTemplate] = useState(DEFAULT_TEMPLATE);
  const [sendTime, setSendTime] = useState("09:00");

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [smsLogs, setSmsLogs] = useState<SmsLogEntry[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [u, p, d] = await Promise.all([
        api.getUsers(), api.getPayments(year, month), api.getDashboard(year, month),
      ]);
      setUsers(u); setPayments(p); setDashboard(d);
    } catch { setToast("데이터 로딩 실패"); }
  }, [year, month]);

  const loadLogs = useCallback(async (page: number) => {
    try {
      const r = await api.getSmsLogs(page);
      setSmsLogs(r.logs); setLogTotal(r.total); setLogPage(page);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (tab === "logs") loadLogs(1); }, [tab, loadLogs]);
  useEffect(() => {
    const saved = localStorage.getItem("smsTemplate");
    if (saved) setSmsTemplate(saved);
    api.getSendTime().then((r) => setSendTime(r.send_time)).catch(() => {});
  }, []);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const handleSaveUser = async () => {
    if (!userName.trim() || !userPhone.trim()) return showToast("이름과 전화번호를 입력하세요");
    try {
      if (editingUser) await api.updateUser(editingUser.id, { name: userName, phone: userPhone.replace(/\D/g, "") });
      else await api.createUser({ name: userName, phone: userPhone.replace(/\D/g, "") });
      setUserName(""); setUserPhone(""); setEditingUser(null);
      showToast(editingUser ? "수정 완료" : "등록 완료"); loadData();
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "오류"); }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    try { await api.deleteUser(id); showToast("삭제 완료"); loadData(); }
    catch (e: unknown) { showToast(e instanceof Error ? e.message : "오류"); }
  };

  const handleAddPayment = async (userId: number) => {
    if (!payDate || !payAmount) return showToast("날짜와 금액을 입력하세요");
    try {
      await api.createPayment({ user_id: userId, due_date: payDate, amount: parseInt(payAmount.replace(/,/g, ""), 10), memo: payMemo });
      setPayDate(""); setPayAmount(""); setPayMemo("");
      showToast("입금 일정 등록 완료"); loadData();
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "오류"); }
  };

  const handleTogglePaid = async (p: Payment) => {
    try { await api.updatePayment(p.id, { is_paid: !p.is_paid }); loadData(); }
    catch (e: unknown) { showToast(e instanceof Error ? e.message : "오류"); }
  };

  const handleDeletePayment = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    try { await api.deletePayment(id); showToast("삭제 완료"); loadData(); }
    catch (e: unknown) { showToast(e instanceof Error ? e.message : "오류"); }
  };

  const handleSendSMS = async (p: Payment) => {
    const msg = buildMessage(smsTemplate, p);
    if (!confirm(`문자 발송:\n\n${msg}`)) return;
    setLoading(true);
    try { await api.sendSMS(p.id, msg); showToast("문자 발송 완료"); loadData(); }
    catch (e: unknown) { showToast(e instanceof Error ? e.message : "발송 실패"); }
    setLoading(false);
  };

  const handleBulkSMS = async () => {
    if (!confirm("미입금 건 일괄 문자 발송하시겠습니까?")) return;
    setLoading(true);
    try { const r = await api.sendBulkSMS(); showToast(r.message); loadData(); }
    catch (e: unknown) { showToast(e instanceof Error ? e.message : "발송 실패"); }
    setLoading(false);
  };

  const changeMonth = (d: number) => {
    let m = month + d, y = year;
    if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; }
    setYear(y); setMonth(m); setSelectedDate(null);
  };

  const selectedPayments = selectedDate ? payments.filter((p) => p.due_date === selectedDate) : [];
  const userPayments = (userId: number) => payments.filter((p) => p.user_id === userId);

  const navItems: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "dashboard", label: "대시보드", icon: icons.dashboard },
    { key: "calendar", label: "달력", icon: icons.calendar },
    { key: "users", label: "사용자 관리", icon: icons.users },
    { key: "logs", label: "발송 이력", icon: icons.logs },
    { key: "settings", label: "설정", icon: icons.settings },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* === Sidebar === */}
      <aside className={`${sidebarOpen ? "w-60" : "w-16"} bg-slate-900 text-white flex flex-col transition-all duration-300 flex-shrink-0`}>
        <div className="p-4 flex items-center gap-3 border-b border-slate-700/50">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0">P</div>
          {sidebarOpen && <span className="font-bold text-lg tracking-tight">PayFlow</span>}
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${tab === item.key
                  ? "bg-indigo-500/20 text-indigo-400"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"}`}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-4 text-slate-500 hover:text-slate-300 text-xs border-t border-slate-700/50"
        >
          {sidebarOpen ? "<<  접기" : ">>"}
        </button>
      </aside>

      {/* === Main Content === */}
      <main className="flex-1 overflow-y-auto">
        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h1 className="text-lg font-bold text-slate-800">
              {{ dashboard: "대시보드", calendar: "달력", users: "사용자 관리", logs: "발송 이력", settings: "설정" }[tab]}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">{year}년 {month}월</p>
          </div>
          <div className="flex items-center gap-3">
            <a href={api.getExcelUrl(year, month)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
              {icons.download} 엑셀
            </a>
            <button onClick={handleBulkSMS} disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {icons.send} {loading ? "발송 중..." : "일괄 문자 발송"}
            </button>
          </div>
        </header>

        {/* Toast */}
        {toast && (
          <div className="fixed top-4 right-4 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-medium animate-[slideIn_0.3s_ease]">
            {toast}
          </div>
        )}

        <div className="p-6">

          {/* ===== DASHBOARD ===== */}
          {tab === "dashboard" && dashboard && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard label="등록 사용자" value={`${dashboard.user_count}명`} color="purple" />
                <StatCard label="오늘 받을 금액" value={`${formatAmount(dashboard.today_amount)}원`} sub={`${dashboard.today_count}건`} color="orange" />
                <StatCard label="총 입금 예정" value={`${dashboard.total_count}건`} sub={`${formatAmount(dashboard.total_amount)}원`} color="blue" />
                <StatCard label="입금 완료" value={`${dashboard.paid_count}건`} sub={`${formatAmount(dashboard.paid_amount)}원`} color="green" />
                <StatCard label="미입금" value={`${dashboard.unpaid_count}건`} sub={`${formatAmount(dashboard.unpaid_amount)}원`} color="red" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 입금률 */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-4">입금 현황</h3>
                  <div className="flex items-end gap-4 mb-4">
                    <span className="text-4xl font-extrabold text-slate-800">
                      {dashboard.total_count > 0 ? Math.round(dashboard.paid_count / dashboard.total_count * 100) : 0}%
                    </span>
                    <span className="text-sm text-slate-400 pb-1">{dashboard.paid_count} / {dashboard.total_count}건 완료</span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-700"
                      style={{ width: `${dashboard.total_count > 0 ? (dashboard.paid_count / dashboard.total_count * 100) : 0}%` }} />
                  </div>
                  <div className="flex justify-between mt-4 text-xs text-slate-400">
                    <span>문자 발송 {dashboard.sms_sent_count}건 완료</span>
                    <span>미입금 {formatAmount(dashboard.unpaid_amount)}원</span>
                  </div>
                </div>

                {/* 최근 발송 */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-700">최근 문자 발송</h3>
                    <button onClick={() => setTab("logs")} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">전체보기</button>
                  </div>
                  {dashboard.recent_logs.length === 0 ? (
                    <p className="text-sm text-slate-400 py-4 text-center">발송 이력 없음</p>
                  ) : (
                    <div className="space-y-3">
                      {dashboard.recent_logs.map((log, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.status === "success" ? "bg-emerald-500" : "bg-rose-500"}`} />
                          <span className="text-sm font-medium text-slate-700 flex-1">{log.user_name}</span>
                          <span className="text-[11px] text-slate-400">
                            {log.sent_at ? new Date(log.sent_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 미입금 리스트 */}
              {payments.filter(p => !p.is_paid).length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-4">미입금 목록</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {payments.filter(p => !p.is_paid).map((p) => (
                      <div key={p.id} className="flex items-center gap-3 p-3 bg-rose-50/50 rounded-xl border border-rose-100">
                        <div className="w-9 h-9 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 font-bold text-xs flex-shrink-0">
                          {p.user.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-slate-700">{p.user.name}</div>
                          <div className="text-xs text-slate-400">{p.due_date} | {formatAmount(p.amount)}원</div>
                        </div>
                        <button onClick={() => handleSendSMS(p)} disabled={loading}
                          className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 flex-shrink-0">문자</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== CALENDAR ===== */}
          {tab === "calendar" && (
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
              <div className="xl:col-span-3">
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <div className="flex items-center justify-between mb-5">
                    <button onClick={() => changeMonth(-1)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 font-bold">&lt;</button>
                    <h2 className="text-lg font-bold text-slate-800 tracking-tight">{year}년 {month}월</h2>
                    <button onClick={() => changeMonth(1)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 font-bold">&gt;</button>
                  </div>
                  <Calendar year={year} month={month} payments={payments} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
                </div>
              </div>

              <div className="space-y-4">
                {selectedDate ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h3 className="text-sm font-bold text-slate-700 mb-3">{selectedDate.replace(/-/g, ".")}</h3>
                    {selectedPayments.length === 0 ? (
                      <p className="text-xs text-slate-400">내역 없음</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedPayments.map((p) => (
                          <div key={p.id} className={`rounded-xl p-3 border ${p.is_paid ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-semibold text-slate-700">{p.user.name}</span>
                              <span className="text-sm font-bold text-slate-800">{formatAmount(p.amount)}원</span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">{formatPhone(p.user.phone)}</div>
                            {p.memo && <div className="text-[11px] text-slate-400 mt-1">{p.memo}</div>}
                            <div className="flex items-center gap-2 mt-2">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" checked={p.is_paid} onChange={() => handleTogglePaid(p)}
                                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                                <span className={`text-[11px] font-medium ${p.is_paid ? "text-emerald-600" : "text-rose-600"}`}>
                                  {p.is_paid ? "입금완료" : "미입금"}
                                </span>
                              </label>
                              {p.sms_sent && <span className="text-[10px] text-indigo-400">발송됨</span>}
                              <div className="flex-1" />
                              {!p.is_paid && (
                                <button onClick={() => handleSendSMS(p)} disabled={loading}
                                  className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800">문자</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <p className="text-xs text-slate-400 text-center py-4">날짜를 선택하세요</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== USERS ===== */}
          {tab === "users" && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-bold text-slate-700 mb-3">{editingUser ? "사용자 수정" : "사용자 등록"}</h3>
                <div className="flex gap-2 flex-wrap">
                  <input type="text" placeholder="이름" value={userName} onChange={(e) => setUserName(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                  <input type="text" placeholder="전화번호" value={userPhone} onChange={(e) => setUserPhone(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                  <button onClick={handleSaveUser}
                    className="bg-indigo-600 text-white rounded-lg px-5 py-2 text-sm font-semibold hover:bg-indigo-700 transition-colors">
                    {editingUser ? "수정" : "등록"}
                  </button>
                  {editingUser && (
                    <button onClick={() => { setEditingUser(null); setUserName(""); setUserPhone(""); }}
                      className="bg-slate-100 text-slate-600 rounded-lg px-4 py-2 text-sm hover:bg-slate-200">취소</button>
                  )}
                </div>
              </div>

              {users.map((u) => {
                const isExpanded = expandedUser === u.id;
                const uPayments = userPayments(u.id);
                const paidCount = uPayments.filter(p => p.is_paid).length;
                const unpaidCount = uPayments.filter(p => !p.is_paid).length;
                return (
                  <div key={u.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors"
                      onClick={() => setExpandedUser(isExpanded ? null : u.id)}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-indigo-400 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                          {u.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 text-sm">{u.name}</div>
                          <div className="text-[11px] text-slate-400">{formatPhone(u.phone)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex gap-2">
                          {paidCount > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{paidCount}건 완료</span>}
                          {unpaidCount > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">{unpaidCount}건 미입금</span>}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); setEditingUser(u); setUserName(u.name); setUserPhone(u.phone); }}
                          className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">수정</button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id); }}
                          className="text-xs text-rose-400 hover:text-rose-600 font-medium">삭제</button>
                        <span className={`text-slate-300 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>{icons.chevron}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-100 px-5 pb-5 bg-slate-50/30">
                        <div className="flex gap-2 py-4 flex-wrap">
                          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          <input type="text" placeholder="금액" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^\d]/g, ""))}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-28 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          <input type="text" placeholder="메모" value={payMemo} onChange={(e) => setPayMemo(e.target.value)}
                            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-36 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          <button onClick={() => handleAddPayment(u.id)}
                            className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-emerald-700 transition-colors">추가</button>
                        </div>

                        {uPayments.length === 0 ? (
                          <p className="text-xs text-slate-400 py-2">등록된 일정 없음</p>
                        ) : (
                          <div className="space-y-1">
                            {uPayments.map((p) => (
                              <div key={p.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white transition-colors">
                                <input type="checkbox" checked={p.is_paid} onChange={() => handleTogglePaid(p)}
                                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                                <span className={`text-sm w-24 ${p.is_paid ? "text-slate-400 line-through" : "font-medium text-slate-700"}`}>
                                  {p.due_date.replace(/-/g, ".")}
                                </span>
                                <span className={`text-sm font-bold w-28 text-right ${p.is_paid ? "text-emerald-600" : "text-slate-800"}`}>
                                  {formatAmount(p.amount)}원
                                </span>
                                <span className="text-[11px] text-slate-400 flex-1 truncate">{p.memo}</span>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full
                                  ${p.is_paid ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                                  {p.is_paid ? "완료" : "미입금"}
                                </span>
                                {p.sms_sent && <span className="text-[10px] text-indigo-400">발송됨</span>}
                                {!p.is_paid && (
                                  <button onClick={() => handleSendSMS(p)} disabled={loading}
                                    className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800">문자</button>
                                )}
                                <button onClick={() => handleDeletePayment(p.id)} className="text-[11px] text-slate-300 hover:text-rose-500">삭제</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {users.length === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                  <div className="text-slate-300 text-4xl mb-3">{icons.users}</div>
                  <p className="text-sm text-slate-400">등록된 사용자가 없습니다</p>
                </div>
              )}
            </div>
          )}

          {/* ===== LOGS ===== */}
          {tab === "logs" && (
            <div className="bg-white rounded-2xl border border-slate-200">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">
                  발송 이력 <span className="text-slate-400 font-normal ml-1">총 {logTotal}건</span>
                </h3>
              </div>

              {smsLogs.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-12">발송 이력 없음</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="text-left py-3 px-5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">이름</th>
                          <th className="text-left py-3 px-5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">전화번호</th>
                          <th className="text-left py-3 px-5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">발송 내용</th>
                          <th className="text-center py-3 px-5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">상태</th>
                          <th className="text-left py-3 px-5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">시간</th>
                          <th className="text-left py-3 px-5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">오류</th>
                        </tr>
                      </thead>
                      <tbody>
                        {smsLogs.map((log) => (
                          <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                            <td className="py-3 px-5 text-sm font-medium text-slate-700">{log.user_name}</td>
                            <td className="py-3 px-5 text-sm text-slate-500">{formatPhone(log.phone)}</td>
                            <td className="py-3 px-5 text-sm text-slate-500 max-w-xs truncate">{log.message}</td>
                            <td className="py-3 px-5 text-center">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full
                                ${log.status === "success" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${log.status === "success" ? "bg-emerald-500" : "bg-rose-500"}`} />
                                {log.status === "success" ? "성공" : "실패"}
                              </span>
                            </td>
                            <td className="py-3 px-5 text-xs text-slate-400">
                              {log.sent_at ? new Date(log.sent_at).toLocaleString("ko-KR") : ""}
                            </td>
                            <td className="py-3 px-5 text-xs text-rose-400">{log.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
                    <span className="text-xs text-slate-400">{logPage} / {Math.max(1, Math.ceil(logTotal / 50))} 페이지</span>
                    <div className="flex gap-2">
                      <button onClick={() => loadLogs(logPage - 1)} disabled={logPage <= 1}
                        className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg disabled:opacity-30 hover:bg-slate-50">이전</button>
                      <button onClick={() => loadLogs(logPage + 1)} disabled={logPage >= Math.ceil(logTotal / 50)}
                        className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg disabled:opacity-30 hover:bg-slate-50">다음</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== SETTINGS ===== */}
          {tab === "settings" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 문자 템플릿 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h3 className="text-sm font-bold text-slate-700 mb-1">문자 템플릿</h3>
                <p className="text-[11px] text-slate-400 mb-4">변수를 사용하여 발송 문자 양식을 설정합니다.</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {["{이름}", "{입금일}", "{금액}", "{메모}"].map((v) => (
                    <code key={v} className="bg-indigo-50 text-indigo-600 text-[11px] px-2 py-0.5 rounded-md font-mono">{v}</code>
                  ))}
                </div>
                <textarea value={smsTemplate} onChange={(e) => setSmsTemplate(e.target.value)} rows={4}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { localStorage.setItem("smsTemplate", smsTemplate); showToast("템플릿 저장 완료"); }}
                    className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-indigo-700 transition-colors">저장</button>
                  <button onClick={() => { setSmsTemplate(DEFAULT_TEMPLATE); localStorage.removeItem("smsTemplate"); showToast("기본값 복원"); }}
                    className="bg-slate-100 text-slate-600 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-200 transition-colors">기본값 복원</button>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100">
                  <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">미리보기</h4>
                  <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 leading-relaxed">
                    {smsTemplate.replace("{이름}", "홍길동").replace("{입금일}", "2026.03.15").replace("{금액}", "500,000").replace("{메모}", " (3월 월세)")}
                  </div>
                </div>
              </div>

              {/* 자동 발송 시간 */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h3 className="text-sm font-bold text-slate-700 mb-1">자동 발송 시간</h3>
                <p className="text-[11px] text-slate-400 mb-4">매일 설정한 시간에 당일 입금 예정자에게 자동 문자가 발송됩니다.</p>
                <div className="flex gap-2 items-center">
                  <input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)}
                    className="border border-slate-200 rounded-lg px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                  <button onClick={async () => {
                      try { await api.setSendTime(sendTime); showToast(`자동 발송 시간: ${sendTime} 저장`); }
                      catch (e: unknown) { showToast(e instanceof Error ? e.message : "오류"); }
                    }}
                    className="bg-indigo-600 text-white rounded-lg px-4 py-2.5 text-xs font-semibold hover:bg-indigo-700 transition-colors">저장</button>
                </div>

                <div className="mt-6 p-4 bg-amber-50 rounded-xl border border-amber-200">
                  <h4 className="text-xs font-bold text-amber-700 mb-1">알리고 API 설정</h4>
                  <p className="text-[11px] text-amber-600 leading-relaxed">
                    backend/.env 파일에 API 키를 설정해야 문자가 발송됩니다.<br />
                    ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
