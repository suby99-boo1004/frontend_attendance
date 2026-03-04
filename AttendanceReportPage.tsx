import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { api } from "../lib/api";

type Period = "day" | "month" | "year";

type UserListItem = {
  id: number;
  name: string;
  email?: string;
};

type DetailDay = {
  work_date: string;
  shift_type?: string | null;
  is_holiday: boolean;
  work_minutes: number;
  work_hours: number;
  session_types: string[];
  places: string[];
  tasks: string[];
  first_start_at?: string | null;
  last_end_at?: string | null;
};

type Details = {
  user_id: number;
  user_name: string;
  start_date: string;
  end_date: string;
  days: DetailDay[];
};

type DaySessionsResponse = {
  sessions?: Array<{
    session_type?: string;
    shift_type?: string;
    start_at?: string | null;
    end_at?: string | null;
    effective_end_at?: string | null;
    work_minutes?: number;
    place?: string | null;
    task?: string | null;
  }>;
  first_start_at?: string | null;
  last_end_at?: string | null;
};


function fmtDT(s?: string | null) {
  if (!s) return "-";
  const d = dayjs(s);
  if (!d.isValid()) return String(s);
  return d.format("YYYY-MM-DD HH:mm");
}

function sessionTypeToKo(code: string) {
  const c = (code || "").toUpperCase();
  if (c === "OFFICE") return "사무실";
  if (c === "OUTSIDE") return "외근";
  if (c === "LEAVE") return "월차";
  if (c.includes("HALF")) return "반차";
  if (c.includes("EARLY")) return "조퇴";
  return code || "-";
}

function uniq(arr: string[]) {
  return Array.from(new Set((arr || []).map((x) => (x || "").trim()).filter(Boolean)));
}

export default function AttendanceReportPage() {
  const nav = useNavigate();

  const [period, setPeriod] = useState<Period>("day");
  const [selectedDay, setSelectedDay] = useState(dayjs().format("YYYY-MM-DD"));
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format("YYYY-MM"));
  const [selectedYear, setSelectedYear] = useState(dayjs().format("YYYY"));

  const buildDateRange = (p: Period) => {
    if (p === "day") return { startDate: selectedDay, endDate: selectedDay };
    if (p === "month") {
      const start = dayjs(selectedMonth).startOf("month").format("YYYY-MM-DD");
      const end = dayjs(selectedMonth).endOf("month").format("YYYY-MM-DD");
      return { startDate: start, endDate: end };
    }
    const start = dayjs(`${selectedYear}-01-01`).format("YYYY-MM-DD");
    const end = dayjs(`${selectedYear}-12-31`).format("YYYY-MM-DD");
    return { startDate: start, endDate: end };
  };

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailsMap, setDetailsMap] = useState<Record<number, Details>>({});
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  // 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalBody, setModalBody] = useState("");

  const openModal = (title: string, body: string) => {
    setModalTitle(title);
    setModalBody(body);
    setModalOpen(true);
  };

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const endpoints = ["/api/users", "/api/admin/users", "/api/admin/user/list"]; // 폴백
      let lastErr: any = null;
      for (const url of endpoints) {
        try {
          const data: any = await api<any>(url);
          const arr = Array.isArray(data)
            ? data
            : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.users)
            ? data.users
            : [];
          const mapped: UserListItem[] = (arr || [])
            .map((u: any) => ({
              id: Number(u?.id ?? u?.user_id),
              name: String(u?.name ?? u?.user_name ?? ""),
              email: u?.email ? String(u.email) : undefined,
            }))
            .filter((u: any) => Number.isFinite(u.id) && u.id > 0 && u.name);

          if (mapped.length > 0) {
            setUsers(mapped.sort((a, b) => a.id - b.id));
            setUsersLoading(false);
            return;
          }
        } catch (e: any) {
          lastErr = e;
        }
      }
      throw lastErr || new Error("직원 목록을 불러오지 못했습니다.");
    } catch (e: any) {
      setUsersError(String(e?.message ?? e));
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredUsers = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return users;
    return users.filter((u) => {
      const name = (u.name || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const id = String(u.id);
      return name.includes(qq) || email.includes(qq) || id.includes(qq);
    });
  }, [users, q]);

  const selectedUsers = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, u] as const));
    return selectedUserIds.map((id) => m.get(id)).filter(Boolean) as UserListItem[];
  }, [users, selectedUserIds]);

  const toggleUser = (id: number) => {
    setSelectedUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].sort((a, b) => a - b)));
  };

  const selectAllVisible = () => {
    const ids = filteredUsers.map((u) => u.id);
    setSelectedUserIds(Array.from(new Set([...selectedUserIds, ...ids])).sort((a, b) => a - b));
  };

  const clearAll = () => setSelectedUserIds([]);

  const openWorkTimeAudit = async (userId: number, userName: string, workDate: string, shownWorkHours?: number) => {
    try {
      const day = await api<DaySessionsResponse>(
        `/api/admin/attendance/day/sessions?user_id=${userId}&work_date=${workDate}`
      );
      const sessions = Array.isArray(day?.sessions) ? day.sessions : [];

      const header = [
        `직원: ${userName} (#${userId})`,
        `날짜: ${workDate}`,
        `표시된 근무시간(상세): ${typeof shownWorkHours === "number" ? shownWorkHours.toFixed(2) + "h" : "-"}`,
        `첫출근: ${fmtDT(day?.first_start_at)}`,
        `마지막퇴근: ${fmtDT(day?.last_end_at)}`,
        "",
        "[세션 원장]",
      ].join("\n");

      const lines = sessions
        .map((s: any, idx: number) => {
          const sa = fmtDT(s?.start_at);
          const ea = fmtDT(s?.end_at);
          const ee = fmtDT(s?.effective_end_at);
          const mins = Number(s?.work_minutes) || 0;
          const st = sessionTypeToKo(String(s?.session_type || "-"));
          const sh = String(s?.shift_type || "-");
          const place = String(s?.place || "");
          const task = String(s?.task || "");
          const endLabel = s?.end_at ? `end=${ea}` : `end=NULL (인정=${ee})`;
          return `${idx + 1}. ${st} | ${sh} | start=${sa} | ${endLabel} | ${(mins / 60).toFixed(2)}h (${mins}분)` +
            (place ? ` | place=${place}` : "") +
            (task ? ` | task=${task}` : "");
        })
        .join("\n");

      openModal("근무시간(세션보기)", `${header}\n${lines || "(세션이 없습니다)"}`);
    } catch (e: any) {
      openModal("근무시간(세션보기)", `불러오기 실패: ${String(e?.message ?? e)}`);
    }
  };

  const onQuery = async () => {
    setError(null);
    setDetailsMap({});
    setExpandedUserId(null);

    if (selectedUserIds.length === 0) {
      setError("직원을 1명 이상 선택해 주세요.");
      return;
    }

    const { startDate, endDate } = buildDateRange(period);
    setBusy(true);
    try {
      const jobs = selectedUserIds.map(async (uid) => {
        const d = await api<Details>(
          `/api/admin/attendance/details?start_date=${startDate}&end_date=${endDate}&user_id=${uid}`
        );
        return [uid, d] as const;
      });
      const pairs = await Promise.all(jobs);
      const map: Record<number, Details> = {};
      for (const [uid, d] of pairs) map[uid] = d;
      setDetailsMap(map);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const periodLabel = period === "day" ? "일별" : period === "month" ? "월별" : "연간";
  const range = buildDateRange(period);

  const summaryRows = useMemo(() => {
    return selectedUserIds.map((uid) => {
      const d = detailsMap[uid];
      const userName = d?.user_name || selectedUsers.find((x) => x.id === uid)?.name || `#${uid}`;
      const days = Array.isArray(d?.days) ? d.days : [];
      const totalHours = days.reduce((acc, x) => acc + (Number(x.work_hours) || 0), 0);
      const offsitePlaces = uniq(days.flatMap((x) => x.places || []));
      return { uid, userName, days, totalHours, offsitePlaces };
    });
  }, [selectedUserIds, detailsMap, selectedUsers]);

  return (
    <div className="vstack" style={{ gap: 14 }}>
      {/* 상단 */}
      <div className="card" style={{ padding: 18 }}>
        <div className="hstack" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div className="h1">출퇴근 기록 · 검색</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              기준: {periodLabel} / 기간: {range.startDate} ~ {range.endDate}
            </div>
          </div>
          <button className="btn" type="button" onClick={() => nav("/attendance")}>출퇴근 기록</button>
        </div>

        <div className="hr" />

        {/* 조회 조건 */}
        <div className="hstack" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="small" style={{ color: "var(--muted)" }}>조회 단위</span>
          <select
            className="input"
            value={period}
            onChange={(e) => {
              const p = e.target.value as Period;
              setPeriod(p);
              if (p === "day") setSelectedDay(dayjs().format("YYYY-MM-DD"));
              if (p === "month") setSelectedMonth(dayjs().format("YYYY-MM"));
              if (p === "year") setSelectedYear(dayjs().format("YYYY"));
            }}
            style={{ width: 120 }}
          >
            <option value="day">일</option>
            <option value="month">월</option>
            <option value="year">년</option>
          </select>

          {period === "day" && (
            <input className="input" type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} style={{ width: 180 }} />
          )}
          {period === "month" && (
            <input className="input" type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} style={{ width: 180 }} />
          )}
          {period === "year" && (
            <select className="input" value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} style={{ width: 180 }}>
              {Array.from({ length: 7 }).map((_, i) => {
                const y = String(dayjs().year() - 3 + i);
                return (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                );
              })}
            </select>
          )}

          <button className="btn primary" type="button" onClick={onQuery} disabled={busy}>
            {busy ? "조회중..." : "조회"}
          </button>
        </div>
      </div>

      {/* 직원 선택 */}
      <div className="card" style={{ padding: 18 }}>
        <div className="h2">직원 선택</div>

        <div className="hstack" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 검색"
            style={{ width: 320 }}
          />

          <button className="btn" type="button" onClick={selectAllVisible} disabled={usersLoading}>
            모두선택
          </button>
          <button className="btn" type="button" onClick={clearAll} disabled={usersLoading}>
            모두해제
          </button>

          <div className="small" style={{ color: "var(--muted)" }}>
            선택됨: <b>{selectedUserIds.length}</b>명 / 표시 {filteredUsers.length}명
          </div>
        </div>

        {usersLoading ? (
          <div className="small" style={{ color: "var(--muted)", marginTop: 10 }}>직원 목록 로딩중...</div>
        ) : usersError ? (
          <div className="card" style={{ borderColor: "rgba(255,106,106,.35)", padding: 12, marginTop: 10 }}>
            <div style={{ color: "var(--danger)", fontSize: 13, whiteSpace: "pre-wrap" }}>{usersError}</div>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 8,
                maxHeight: 260,
                overflow: "auto",
                paddingRight: 4,
              }}
            >
              {filteredUsers.map((u) => (
                <label key={u.id} className="card" style={{ padding: 7, cursor: "pointer", display: "flex", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                    style={{ marginRight: 8 }}
                  />
                  <b style={{ fontSize: 13 }}>{u.name}</b>
                </label>
              ))}
            </div>

            {filteredUsers.length === 0 && (
              <div className="small" style={{ color: "var(--muted)", marginTop: 8, textAlign: "center" }}>검색 결과 없음</div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="card" style={{ borderColor: "rgba(255,106,106,.35)", padding: 12 }}>
          <b style={{ color: "var(--danger)" }}>오류</b>
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap", fontSize: 13 }}>{error}</div>
        </div>
      )}

      {/* 조회 결과 */}
      <div className="card" style={{ padding: 18 }}>
        <div className="hstack" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div className="h2">조회 결과</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              * 행 클릭 시 상세 펼침
            </div>
          </div>
          <div className="small" style={{ color: "var(--muted)" }}>
            선택 직원: {selectedUsers.map((u) => u.name).join(", ") || "-"}
          </div>
        </div>

        <div className="hr" />

        {selectedUserIds.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>직원을 선택하고 조회를 눌러주세요.</div>
        ) : Object.keys(detailsMap).length === 0 ? (
          <div className="small" style={{ color: "var(--muted)" }}>조회 결과가 아직 없습니다.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                  <th style={{ padding: "8px 6px" }}>직원</th>
                  <th style={{ padding: "8px 6px" }}>기간</th>
                  <th style={{ padding: "8px 6px" }}>건수</th>
                  <th style={{ padding: "8px 6px" }}>총 근무시간</th>
                  <th style={{ padding: "8px 6px" }}>외근 장소</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((sr) => {
                  const isOpen = expandedUserId === sr.uid;
                  return (
                    <React.Fragment key={sr.uid}>
                      <tr
                        onClick={() => setExpandedUserId(isOpen ? null : sr.uid)}
                        style={{ borderTop: "1px solid rgba(255,255,255,.07)", cursor: "pointer" }}
                      >
                        <td style={{ padding: "8px 6px" }}><b>{sr.userName}</b></td>
                        <td style={{ padding: "8px 6px" }}>{range.startDate} ~ {range.endDate}</td>
                        <td style={{ padding: "8px 6px" }}>{sr.days.length}</td>
                        <td style={{ padding: "8px 6px" }}>{sr.totalHours.toFixed(2)}</td>
                        <td style={{ padding: "8px 6px" }}>{sr.offsitePlaces.slice(0, 3).join(", ") || "-"}{sr.offsitePlaces.length > 3 ? " ..." : ""}</td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={5} style={{ padding: 12, background: "rgba(255,255,255,.03)" }}>
                            <div className="hstack" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                              <b>{sr.userName}</b>
                              <div className="small" style={{ color: "var(--muted)" }}>
                                {range.startDate} ~ {range.endDate} / {sr.days.length}건
                              </div>
                              <button
                                className="btn"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const body = (sr.days || [])
                                    .map((x) => `${x.work_date}: ${(x.places || []).join(", ") || "-"}`)
                                    .join("\n");
                                  openModal("외근장소 전체보기", body || "내용 없음");
                                }}
                                disabled={sr.days.length === 0}
                              >
                                외근장소 전체보기
                              </button>
                            </div>

                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead>
                                  <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                                    <th style={{ padding: "8px 6px" }}>날짜</th>
                                    <th style={{ padding: "8px 6px" }}>출근(날짜+시간)</th>
                                    <th style={{ padding: "8px 6px" }}>퇴근(날짜+시간)</th>
                                    <th style={{ padding: "8px 6px" }}>근무시간</th>
                                    <th style={{ padding: "8px 6px" }}>주야</th>
                                    <th style={{ padding: "8px 6px" }}>근무형태</th>
                                    <th style={{ padding: "8px 6px" }}>외근장소</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sr.days.map((x) => {
                                    const places = uniq(x.places || []);
                                    const placesShort = places.slice(0, 2).join(", ") || "-";
                                    const workTypes = (x.session_types || []).map(sessionTypeToKo).filter(Boolean);
                                    return (
                                      <tr key={x.work_date} style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
                                        <td style={{ padding: "8px 6px" }}><b>{x.work_date}</b></td>
                                        <td style={{ padding: "8px 6px" }}>{fmtDT(x.first_start_at)}</td>
                                        <td style={{ padding: "8px 6px" }}>{fmtDT(x.last_end_at)}</td>
                                        <td style={{ padding: "8px 6px" }}>
                                          <div className="hstack" style={{ gap: 8, alignItems: "center" }}>
                                            <span>{Number(x.work_hours || 0).toFixed(2)}h</span>
                                            <button
                                              className="btn"
                                              type="button"
                                              style={{ padding: "4px 8px" }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openWorkTimeAudit(sr.uid, sr.userName, x.work_date, Number(x.work_hours || 0));
                                              }}
                                            >
                                              세션보기
                                            </button>
                                          </div>
                                        </td>
                                        <td style={{ padding: "8px 6px" }}>{x.shift_type || "-"}</td>
                                        <td style={{ padding: "8px 6px" }}>{workTypes.join(", ") || "-"}</td>
                                        <td style={{ padding: "8px 6px" }}>
                                          <div className="hstack" style={{ gap: 8, alignItems: "center" }}>
                                            <span>{placesShort}</span>
                                            <button
                                              className="btn"
                                              type="button"
                                              style={{ padding: "4px 8px" }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openModal("외근장소(전체보기)", places.join("\n") || "내용 없음");
                                              }}
                                              disabled={places.length === 0}
                                            >
                                              전체보기
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}

                                  {sr.days.length === 0 && (
                                    <tr>
                                      <td colSpan={7} className="small" style={{ padding: "10px 6px" }}>
                                        해당 기간 데이터 없음
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div onClick={() => setModalOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={modalHeader}>
              <b style={{ color: "#111" }}>{modalTitle}</b>
              <button type="button" onClick={() => setModalOpen(false)} style={closeBtn}>닫기</button>
            </div>
            <div style={modalBodyStyle}>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, color: "#111", fontSize: 13 }}>{modalBody || "내용 없음"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== modal styles (고정) =====
const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
};

const modalCard: React.CSSProperties = {
  width: "min(920px, 100%)",
  maxHeight: "80vh",
  background: "#fff",
  borderRadius: 14,
  border: "1px solid #ddd",
  boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const modalHeader: React.CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #eee",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const closeBtn: React.CSSProperties = {
  marginLeft: "auto",
  padding: "6px 8px",
  border: "1px solid #ddd",
  borderRadius: 10,
  background: "#fff",
  cursor: "pointer",
  color: "#111",
};

const modalBodyStyle: React.CSSProperties = { padding: 14, overflow: "auto" };
