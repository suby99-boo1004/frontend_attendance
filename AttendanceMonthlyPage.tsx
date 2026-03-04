import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

type DayRow = {
  user_id: number;
  user_name: string;
  work_date_basis: string; // ISO date
  total_minutes: number;
  day_minutes: number;
  night_minutes: number;
  office_minutes: number;
  outside_minutes: number;
  sessions: number;
};

type UserRow = {
  user_id: number;
  user_name: string;
  total_minutes: number;
  day_minutes: number;
  night_minutes: number;
  office_minutes: number;
  outside_minutes: number;
  sessions: number;
  night_days: number;
  leave_days: number;
  half_leave_days: number;
  holiday_work_days: number;
};

function toHHMM(mins: number): string {
  const m = Math.max(0, Math.floor(mins || 0));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${hh}:${String(mm).padStart(2, "0")}`;
}

function resolveUrl(path: string): string {
  const base: string = (import.meta.env.BASE_URL || "/").trim();
  const basePrefix = base === "/" ? "" : base.endsWith("/") ? base.slice(0, -1) : base;
  if (!path.startsWith("/")) return `${basePrefix}/${path}`;
  return `${basePrefix}${path}`;
}

export default function AttendanceMonthlyPage() {
  const { user } = useAuth();
  const nav = useNavigate();

  const isAdmin = user?.role_code === "ADMIN";

  const defaultMonth = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, []);

  const [month, setMonth] = useState(defaultMonth);
  const [mode, setMode] = useState<"day" | "user">("user");
  const [dayRows, setDayRows] = useState<DayRow[]>([]);
  const [userRows, setUserRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (!isAdmin) {
      nav("/", { replace: true });
    }
  }, [user, isAdmin, nav]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (mode === "day") {
        const data = await api.get<DayRow[]>(`/api/admin/attendance/monthly/summary?month=${encodeURIComponent(month)}`);
        setDayRows(data);
      } else {
        const data = await api.get<UserRow[]>(
          `/api/admin/attendance/monthly/users-summary?month=${encodeURIComponent(month)}`
        );
        setUserRows(data);
      }
    } catch (e: any) {
      setError(e?.message || "조회 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, isAdmin, mode]);

  async function downloadExcel() {
    try {
      const token = localStorage.getItem("uplink_token");
      const url = resolveUrl(`/api/admin/attendance/monthly/excel?month=${encodeURIComponent(month)}`);
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`다운로드 실패 (${res.status}) ${t}`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const fileUrl = window.URL.createObjectURL(blob);
      a.href = fileUrl;
      a.download = `월별근태_${month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (e: any) {
      alert(e?.message || "다운로드 실패");
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>월별 근태(관리자)</h2>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 13 }}>월(YYYY-MM)</label>
            <input value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 110 }} />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                className={mode === "user" ? "btn" : "btn secondary"}
                onClick={() => setMode("user")}
                disabled={loading}
              >
                직원별 합계
              </button>
              <button
                className={mode === "day" ? "btn" : "btn secondary"}
                onClick={() => setMode("day")}
                disabled={loading}
              >
                일자별 상세
              </button>
            </div>

            <button className="btn" onClick={load} disabled={loading}>
              조회
            </button>
            <button
              className="btn"
              onClick={downloadExcel}
              disabled={loading || (mode === "day" ? dayRows.length === 0 : userRows.length === 0)}
            >
              엑셀 다운로드
            </button>
          </div>
        </div>

        {error && (
          <div className="badge" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table className="table">
            <thead>
              {mode === "day" ? (
                <tr>
                  <th>귀속일</th>
                  <th>이름</th>
                  <th>총</th>
                  <th>주간</th>
                  <th>야간</th>
                  <th>사무실</th>
                  <th>외근</th>
                  <th>세션</th>
                </tr>
              ) : (
                <tr>
                  <th>이름</th>
                  <th>총</th>
                  <th>주간</th>
                  <th>야간</th>
                  <th>야간(횟수)</th>
                  <th>월차(횟수)</th>
                  <th>반차(횟수)</th>
                  <th>휴일근무(횟수)</th>
                  <th>사무실</th>
                  <th>외근</th>
                  <th>세션</th>
                </tr>
              )}
            </thead>
            <tbody>
              {mode === "day" &&
                dayRows.map((r) => (
                  <tr key={`${r.user_id}-${r.work_date_basis}`}>
                    <td>{r.work_date_basis}</td>
                    <td>{r.user_name}</td>
                    <td>{toHHMM(r.total_minutes)}</td>
                    <td>{toHHMM(r.day_minutes)}</td>
                    <td>{toHHMM(r.night_minutes)}</td>
                    <td>{toHHMM(r.office_minutes)}</td>
                    <td>{toHHMM(r.outside_minutes)}</td>
                    <td>{r.sessions}</td>
                  </tr>
                ))}

              {mode === "user" &&
                userRows.map((r) => (
                  <tr key={`${r.user_id}`}>
                    <td>{r.user_name}</td>
                    <td>{toHHMM(r.total_minutes)}</td>
                    <td>{toHHMM(r.day_minutes)}</td>
                    <td>{toHHMM(r.night_minutes)}</td>
                    <td>{r.night_days}</td>
                    <td>{r.leave_days}</td>
                    <td>{r.half_leave_days}</td>
                    <td>{r.holiday_work_days}</td>
                    <td>{toHHMM(r.office_minutes)}</td>
                    <td>{toHHMM(r.outside_minutes)}</td>
                    <td>{r.sessions}</td>
                  </tr>
                ))}

              {(mode === "day" ? dayRows.length === 0 : userRows.length === 0) && !loading && (
                <tr>
                  <td colSpan={mode === "day" ? 8 : 11} style={{ textAlign: "center", opacity: 0.7 }}>
                    데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
