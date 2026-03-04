import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * 출퇴근(Work Sessions) 프론트
 * - 동시 출근/외근/퇴근(여러 명)
 * - 장소/업무 입력
 * - 휴일 체크
 * - 직원 목록 체크박스 + 폴백(ID 직접 입력)
 * - 월차/반차(등록)
 * - 조퇴(등록): 당일 시간만 선택 + 사유
 */

type ShiftType = "DAY" | "NIGHT";
type SessionType = "OFFICE" | "OUTSIDE";
type LeaveType = "LEAVE" | "HALF_LEAVE";

type TodayStatusItem = {
  user_id: number;
  user_name?: string;
  status?: "OFFICE" | "OUTSIDE" | "LEAVE" | "HALF_LEAVE" | "EARLY_LEAVE" | "TRIP_VIRTUAL" | "NONE" | string;

  shift_type?: "DAY" | "NIGHT" | string;
  is_working?: boolean;

  place?: string | null;
  task?: string | null;

  start_at?: string | null;
  end_at?: string | null;

  worked_minutes?: number;
  session_count?: number;
  sessions?: Array<{
    session_type?: string | null;
    shift_type?: string | null;
    is_holiday?: boolean;
    place?: string | null;
    task?: string | null;
    start_at?: string | null;
    end_at?: string | null;
  }>;
  is_overtime?: boolean;
  is_holiday?: boolean;
};

type UserListItem = {
  id: number;
  name: string;
  email?: string;
  role_id?: number;
  department_id?: number | null;
  status: string;
};
const INTERNAL_ROLE_IDS = new Set<number>([6, 7, 8]);
function isInternalUser(u: UserListItem | null | undefined) {
  const rid = u?.role_id;
  return typeof rid === "number" && INTERNAL_ROLE_IDS.has(rid);
}


function fmtHM(mins?: number | null) {
  if (!mins || mins <= 0) return "-";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}시간 ${m}분`;
}

function fmtDT_HM(v?: string | null) {
  if (!v) return "-";
  try {
    const d = new Date(v);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return String(v);
  }
}

function sessionTypeLabel(t?: string | null) {
  if (!t) return "-";
  if (t === "OFFICE") return "사무실";
  if (t === "OUTSIDE") return "외근";
  if (t === "TRIP_VIRTUAL") return "외근/원격";
  if (t === "LEAVE") return "월차";
  if (t === "HALF_LEAVE") return "반차";
  if (t === "EARLY_LEAVE") return "조퇴";
  return String(t);
}

function sessionTypeClass(t?: string | null) {
  if (!t) return "sessTagUnknown";
  if (t === "OFFICE") return "sessTagOffice";
  if (t === "OUTSIDE" || t === "TRIP_VIRTUAL") return "sessTagOutside";
  if (t === "LEAVE") return "sessTagLeave";
  if (t === "HALF_LEAVE") return "sessTagHalfLeave";
  if (t === "EARLY_LEAVE") return "sessTagEarlyLeave";
  return "sessTagUnknown";
}

function statusBadgeClass(status?: string | null) {
  if (!status) return "badgeUnknown";
  if (status === "OFFICE") return "badgeOffice";
  if (status === "OUTSIDE" || status === "TRIP_VIRTUAL") return "badgeOutside";
  if (status === "LEAVE") return "badgeLeave";
  if (status === "HALF_LEAVE") return "badgeHalfLeave";
  if (status === "EARLY_LEAVE") return "badgeEarlyLeave";
  if (status === "NONE") return "badgeUnknown";
  return "badgeUnknown";
}

function parseUserIds(input: string): number[] {
  const parts = input
    .split(/[,\s]+/g)
    .map((v) => v.trim())
    .filter(Boolean);

  const ids: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) continue;
    ids.push(n);
  }
  return Array.from(new Set(ids));
}

function hmToISOForToday(timeHHMM: string): string | null {
  // "HH:MM" -> 오늘 날짜의 ISO(UTC)로 변환
  if (!timeHHMM || !/^\d{2}:\d{2}$/.test(timeHHMM)) return null;
  const [hh, mm] = timeHHMM.split(":").map((v) => Number(v));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

export default function AttendancePage() {
  const { user: me } = useAuth();
  const isAdmin = (me as any)?.role_code === "ADMIN";

  const nav = useNavigate();

  const [shiftType, setShiftType] = useState<ShiftType>("DAY");
  const [holidayWork, setHolidayWork] = useState(false);

  // 직원 목록(체크박스)
  const [users, setUsers] = useState<UserListItem[] | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  // 폴백: ID 직접 입력
  const [targetUserIdsText, setTargetUserIdsText] = useState("1");
  const targetUserIdsFromText = useMemo(() => parseUserIds(targetUserIdsText), [targetUserIdsText]);

  const targetUserIds = useMemo(() => {
    if (selectedUserIds.length > 0) return selectedUserIds;
    return targetUserIdsFromText;
  }, [selectedUserIds, targetUserIdsFromText]);

  const [place, setPlace] = useState("");
  const [task, setTask] = useState("");

  // ✅ 출퇴근 시각 수동 지정(옵션)
  const [manualAtEnabled, setManualAtEnabled] = useState(false);
  const [manualAtLocal, setManualAtLocal] = useState<string>(""); // datetime-local

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [todayStatus, setTodayStatus] = useState<TodayStatusItem[]>([]);
  const [expandedUserIds, setExpandedUserIds] = useState<Record<number, boolean>>({});

  // 월차/반차 UI
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>("LEAVE");
  const [leaveDate, setLeaveDate] = useState<string>("");
  const [leaveReason, setLeaveReason] = useState<string>("");
  const [leaveTime, setLeaveTime] = useState<string>(""); // HH:MM (반차용)

  // ✅ 조퇴 UI
  const [earlyLeaveOpen, setEarlyLeaveOpen] = useState(false);
  const [earlyLeaveTime, setEarlyLeaveTime] = useState<string>("");
  const [earlyLeaveReason, setEarlyLeaveReason] = useState<string>("");

  const sortedTodayStatus = useMemo(() => {
    const byId = new Map<number, any>();
    (todayStatus || []).forEach((it: any) => {
      if (it && typeof it.user_id === "number") byId.set(it.user_id, it);
    });

    const merged: any[] = [];
    (users || []).forEach((u: any) => {
      const item = byId.get(u.id);
      if (item) merged.push({ ...item, user_name: item.user_name ?? u.name });
      else {
        merged.push({
          user_id: u.id,
          user_name: u.name,
          status: "NONE",
          shift_type: null,
          is_working: false,
          place: null,
          task: null,
          start_at: null,
          end_at: null,
          worked_minutes: 0,
          sessions: [],
          session_count: 0,
        });
      }
    });

    // users 목록을 로드하지 못한 경우(권한/엔드포인트 차이 등)에는 todayStatus만 그대로 표시한다.
    // users가 있는 경우에는 users(=내부 인원 필터링된 목록)를 기준으로만 렌더링하여 외부/guest가 섞이지 않도록 한다.
    if (!users) {
      (todayStatus || []).forEach((it: any) => {
        if (it && typeof it.user_id === "number") merged.push(it);
      });
    }

    merged.sort((a, b) => (a.user_id || 0) - (b.user_id || 0));
    return merged;
  }, [todayStatus, users]);

  async function loadUsers() {
    try {
      const list = await api<UserListItem[]>("/api/users", { method: "GET" });
      const filtered = (list || []).filter(isInternalUser);
      setUsers([...filtered].sort((a, b) => (a.id || 0) - (b.id || 0)));
    } catch {
      try {
        const list = await api<UserListItem[]>("/api/admin/users", { method: "GET" });
         const filtered = (list || []).filter(isInternalUser);
         setUsers([...filtered].sort((a, b) => (a.id || 0) - (b.id || 0)));
      } catch {
        setUsers(null);
      }
    }
  }

  async function refreshStatus() {
    setErr(null);
    try {
      const list = await api<TodayStatusItem[]>("/api/attendance/today/status?include_all=true", { method: "GET" });
      setTodayStatus(list);
    } catch (e: any) {
      setErr(e?.message || "오늘 현황 조회 실패(서버/API 확인 필요)");
      setTodayStatus([]);
    }
  }

  async function refreshAll() {
    await Promise.all([loadUsers(), refreshStatus()]);
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!me) return;
    setTargetUserIdsText(String(me.id));
    if (users && selectedUserIds.length === 0) setSelectedUserIds([me.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, users]);

  function toggleUser(id: number) {
    setSelectedUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAll() {
    if (!users) return;
    setSelectedUserIds(users.map((u) => u.id));
  }

  function clearAll() {
    setSelectedUserIds([]);
  }

  function toggleExpand(userId: number) {
    setExpandedUserIds((prev) => ({ ...prev, [userId]: !prev[userId] }));
  }

  function getOverrideISO(): string | null {
    if (!manualAtEnabled) return null;
    if (!manualAtLocal) return null;
    const d = new Date(manualAtLocal);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function clearManualAt() {
    setManualAtEnabled(false);
    setManualAtLocal("");
  }

  async function bulkStart(sessionType: SessionType) {
    if (targetUserIds.length === 0) {
      setErr("대상 직원을 선택하거나(ID 입력) 입력하세요.");
      return;
    }
    if (sessionType === "OUTSIDE") {
      if (!place.trim()) return setErr("외근/직출 장소를 입력하세요.");
      if (!task.trim()) return setErr("외근 내용을 입력하세요.");
    }

    setBusy(true);
    setErr(null);
    try {
      await api<{ created: number }>("/api/work-sessions/bulk/start", {
        method: "POST",
        body: JSON.stringify({
          user_ids: targetUserIds,
          session_type: sessionType,
          shift_type: shiftType,
          place: place.trim() ? place.trim() : null,
          task: task.trim() ? task.trim() : null,
          is_holiday: holidayWork,
          at: getOverrideISO(),
        }),
      });
      await refreshStatus();
      if (manualAtEnabled) clearManualAt();
    } catch (e: any) {
      setErr(e?.message || "처리 실패");
    } finally {
      setBusy(false);
    }
  }

  async function bulkEnd() {
    if (targetUserIds.length === 0) return setErr("대상 직원을 선택하거나(ID 입력) 입력하세요.");
    setBusy(true);
    setErr(null);
    try {
      await api<{ ended: number }>("/api/work-sessions/bulk/end", {
        method: "POST",
        body: JSON.stringify({ user_ids: targetUserIds, at: getOverrideISO() }),
      });
      await refreshStatus();
      if (manualAtEnabled) clearManualAt();
    } catch (e: any) {
      setErr(e?.message || "퇴근 처리 실패");
    } finally {
      setBusy(false);
    }
  }

  function openLeaveModal(t: LeaveType) {
    setLeaveType(t);
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const hh = String(today.getHours()).padStart(2, "0");
    const mi = String(today.getMinutes()).padStart(2, "0");
    setLeaveDate(`${yyyy}-${mm}-${dd}`);
    // 반차는 날짜+시간이 필수
    setLeaveTime(`${hh}:${mi}`);
    setLeaveReason("");
    setLeaveModalOpen(true);
  }

  async function submitLeave() {
    if (!leaveDate) return setErr("날짜를 선택하세요.");
    if (targetUserIds.length === 0) return setErr("대상 직원을 선택하거나(ID 입력) 입력하세요.");
    // 반차는 날짜+시간 필수
    if (leaveType === "HALF_LEAVE") {
      if (!leaveTime) return setErr("반차 시간을 선택하세요.");
    }

    setBusy(true);
    setErr(null);
    try {
      if (leaveType === "HALF_LEAVE") {
        await api<{ created: number }>("/api/attendance/half-leave/bulk", {
          method: "POST",
          body: JSON.stringify({
            user_ids: targetUserIds,
            work_date: leaveDate,
            time_hm: leaveTime,
            reason: leaveReason.trim() ? leaveReason.trim() : null,
          }),
        });
      } else {
        // 월차는 기존 로직 유지(당일/미리 등록 가능)
        await api<{ created: number }>("/api/work-sessions/bulk/leave", {
          method: "POST",
          body: JSON.stringify({
            user_ids: targetUserIds,
            work_date: leaveDate,
            leave_type: "LEAVE",
            reason: leaveReason.trim() ? leaveReason.trim() : null,
          }),
        });
      }

      setLeaveModalOpen(false);
      await refreshStatus();
    } catch (e: any) {
      setErr(e?.message || "월차/반차 등록 실패");
    } finally {
      setBusy(false);
    }
  }

  function openEarlyLeave() {
    // 기본값: 현재 시각(HH:MM)
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    setEarlyLeaveTime(`${hh}:${mm}`);
    setEarlyLeaveReason("");
    setEarlyLeaveOpen(true);
  }

  async function submitEarlyLeave() {
    if (targetUserIds.length === 0) return setErr("대상 직원을 선택하거나(ID 입력) 입력하세요.");
    if (!earlyLeaveTime) return setErr("조퇴 시간을 선택하세요.");

    setBusy(true);
    setErr(null);
    try {
      await api<{ created: number }>("/api/attendance/early-leave/bulk", {
        method: "POST",
        body: JSON.stringify({
          user_ids: targetUserIds,
          time_hm: earlyLeaveTime,
          reason: earlyLeaveReason.trim() ? earlyLeaveReason.trim() : null,
        }),
      });
      setEarlyLeaveOpen(false);
      await refreshStatus();
    } catch (e: any) {
      setErr(e?.message || "조퇴 등록 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vstack" style={{ gap: 14 }}>
      {/* datetime-local 아이콘(다크모드) */}
      <style>{`input[type="datetime-local"]::-webkit-calendar-picker-indicator{filter:invert(1);}`}</style>

      <div className="card" style={{ padding: 18 }}>
        <div className="hstack" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div className="h1">출퇴근 기록</div>
          <button className="btn" type="button" onClick={() => nav("/attendance/report")}>
            검색
          </button>
        </div>
        <div className="small" style={{ color: "var(--muted)" }}>
          (Phase 1) 동시 처리 · 외근/직출/직퇴 장소·업무 입력 · 휴일 체크 · 직원 체크박스 선택
        </div>

        <div className="hr" />

        <div className="hstack" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="badge" style={{ cursor: "pointer" }}>
            <input type="radio" name="shift" checked={shiftType === "DAY"} onChange={() => setShiftType("DAY")} /> 주간
          </label>
          <label className="badge" style={{ cursor: "pointer" }}>
            <input type="radio" name="shift" checked={shiftType === "NIGHT"} onChange={() => setShiftType("NIGHT")} /> 야간(다음날 귀속)
          </label>
          <label className="badge" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={holidayWork} onChange={(e) => setHolidayWork(e.target.checked)} /> 휴일/주말 근무
          </label>
        </div>

        <div className="hr" />

        <div className="vstack" style={{ gap: 10 }}>
          <div className="h2">대상 직원 선택</div>

          {users && users.length > 0 ? (
            <div className="vstack" style={{ gap: 8 }}>
              <div className="hstack" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={selectAll} disabled={busy}>
                  전체선택
                </button>
                <button className="btn" onClick={clearAll} disabled={busy}>
                  선택해제
                </button>
                <span className="small" style={{ color: "var(--muted)" }}>
                  선택됨: <b>{selectedUserIds.length}</b>명
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 8,
                }}
              >
                {users.map((u) => (
                  <label key={u.id} className="card" style={{ padding: 7, cursor: "pointer" }}>
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

              <div className="small" style={{ color: "var(--muted)" }}>
                * 체크박스 선택이 있으면 ID 입력보다 우선합니다.
              </div>
            </div>
          ) : (
            <div className="vstack" style={{ gap: 6 }}>
              <div className="small">직원 목록 API가 없어서 ID 직접 입력 모드입니다.</div>
              <input
                className="input"
                value={targetUserIdsText}
                onChange={(e) => setTargetUserIdsText(e.target.value)}
                placeholder="예: 1,2,3"
              />
              <div className="small" style={{ color: "var(--muted)" }}>
                현재 입력된 대상: <b>{targetUserIdsFromText.length ? targetUserIdsFromText.join(", ") : "없음"}</b>
              </div>
            </div>
          )}

          <div className="hr" />

          <div className="h2">시간</div>

          <div className="hstack" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" type="button" onClick={() => setManualAtEnabled((v) => !v)} disabled={busy}>
              시간/날짜
            </button>
            <button className="btn" type="button" onClick={clearManualAt} disabled={busy}>
              초기화
            </button>

            {manualAtEnabled && (
              <input
                className="input"
                type="datetime-local"
                value={manualAtLocal}
                onChange={(e) => setManualAtLocal(e.target.value)}
                style={{ width: 220, colorScheme: "dark" }}
              />
            )}

            {manualAtEnabled && manualAtLocal && (
              <div className="small" style={{ opacity: 0.9 }}>
                선택: {manualAtLocal.replace("T", " ")}
              </div>
            )}
          </div>

          <div className="hr" />

          <div className="h2">장소/업무</div>
          <div className="hstack" style={{ gap: 10, flexWrap: "wrap" }}>
            <div className="vstack" style={{ gap: 6, minWidth: 280, flex: 1 }}>
              <div className="small">장소(외근/직출/외출/직퇴)</div>
              <input
                className="input"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="예: 본사 / 울산 차량기지 / ○○역사"
              />
            </div>
            <div className="vstack" style={{ gap: 6, minWidth: 280, flex: 2 }}>
              <div className="small">외근/외출 내용</div>
              <input
                className="input"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="예: CCTV 점검 / 현장회의 / 장비 반입"
              />
            </div>
          </div>

          {err && (
            <div className="card" style={{ borderColor: "rgba(255,106,106,.35)", padding: 12, marginTop: 10 }}>
              <div style={{ color: "var(--danger)", fontSize: 13, whiteSpace: "pre-wrap" }}>{err}</div>
              <div className="small" style={{ marginTop: 6 }}>
                체크: (1) 백엔드 8000 실행 (2) /docs에서 API 보이는지 (3) 로그인 토큰(401) 확인
              </div>
            </div>
          )}

          {/* 버튼 순서: 출퇴근(사무실)-외근/직출-월차-반차-조퇴-퇴근/직퇴-새로고침 */}
          <div className="hstack" style={{ gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button className="btn primary" onClick={() => bulkStart("OFFICE")} disabled={busy}>
              출근(사무실)
            </button>
            <button className="btn primary" onClick={() => bulkStart("OUTSIDE")} disabled={busy}>
              외근/직출/외출
            </button>
            <button className="btn" onClick={() => openLeaveModal("LEAVE")} disabled={busy}>
              월차
            </button>
            <button className="btn" onClick={() => openLeaveModal("HALF_LEAVE")} disabled={busy}>
              반차
            </button>
            <button className="btn" onClick={openEarlyLeave} disabled={busy}>
              조퇴
            </button>
            <button className="btn" onClick={bulkEnd} disabled={busy}>
              퇴근/직퇴
            </button>
            <button className="btn" onClick={refreshAll} disabled={busy}>
              새로고침
            </button>
          </div>

          {leaveModalOpen && (
            <div className="card" style={{ padding: 14, marginTop: 12, border: "1px solid var(--border)" }}>
              <div className="h2" style={{ marginBottom: 10 }}>
                {leaveType === "LEAVE" ? "월차" : "반차"} 등록
              </div>

              
              <div className="hstack" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div className="vstack" style={{ gap: 6 }}>
                  <div className="small">날짜</div>
                  <input
                    className="input"
                    type="date"
                    value={leaveDate}
                    onChange={(e) => setLeaveDate(e.target.value)}
                    style={{ width: 250 }}
                  />
                </div>

                {leaveType === "HALF_LEAVE" && (
                  <div className="vstack" style={{ gap: 6 }}>
                    <div className="small">반차 시간</div>
                    <input
                      className="input"
                      type="time"
                      value={leaveTime}
                      onChange={(e) => setLeaveTime(e.target.value)}
                      style={{ width: 250 }}
                    />
                  </div>
                )}

                <div className="vstack" style={{ gap: 6 }}>
                  <div className="small">사유(선택)</div>
                  <input
                    className="input"
                    value={leaveReason}
                    onChange={(e) => setLeaveReason(e.target.value)}
                    placeholder="예: 개인사정 / 병원 / 가족행사"
                    style={{ width: 380 }}
                  />
                </div>
              </div>

<div className="hstack" style={{ gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn" onClick={() => setLeaveModalOpen(false)} disabled={busy}>
                  취소
                </button>
                <button className="btn primary" onClick={submitLeave} disabled={busy}>
                  확인
                </button>
              </div>
            </div>
          )}

          {earlyLeaveOpen && (
            <div className="card" style={{ padding: 14, marginTop: 12, border: "1px solid var(--border)" }}>
              <div className="h2" style={{ marginBottom: 10 }}>
                조퇴 등록
              </div>

              
              <div className="hstack" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div className="vstack" style={{ gap: 6 }}>
                  <div className="small">조퇴 시간</div>
                  <input
                    className="input"
                    type="time"
                    value={earlyLeaveTime}
                    onChange={(e) => setEarlyLeaveTime(e.target.value)}
                    style={{ width: 250 }}
                  />
                </div>

                <div className="vstack" style={{ gap: 6 }}>
                  <div className="small">사유(선택)</div>
                  <input
                    className="input"
                    value={earlyLeaveReason}
                    onChange={(e) => setEarlyLeaveReason(e.target.value)}
                    placeholder="예: 병원 / 아이 하원 / 개인사정"
                    style={{ width: 380 }}
                  />
                </div>
              </div>

<div className="hstack" style={{ gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn" onClick={() => setEarlyLeaveOpen(false)} disabled={busy}>
                  취소
                </button>
                <button className="btn primary" onClick={submitEarlyLeave} disabled={busy}>
                  확인
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="h2">오늘 근무 현황</div>

        <div className="hr" />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                <th style={{ padding: "8px 6px" }}>이름</th>
                <th style={{ padding: "8px 6px" }}>상태</th>
                <th style={{ padding: "8px 6px" }}>장소</th>
                <th style={{ padding: "8px 6px" }}>외근 내용</th>
                <th style={{ padding: "8px 6px" }}>출근시간</th>
                <th style={{ padding: "8px 6px" }}>퇴근시간</th>
                {isAdmin && <th style={{ padding: "8px 6px" }}>근무시간(합산)</th>}
                <th style={{ padding: "8px 6px" }}>세션수</th>
              </tr>
            </thead>
            <tbody>
              {sortedTodayStatus.map((u) => {
                const isWorking =
                  (u.status === "OFFICE" || u.status === "OUTSIDE" || u.status === "TRIP_VIRTUAL") &&
                  ((u.is_working ?? false) || (!!u.start_at && !u.end_at));

                const shiftLabel =
                  u.shift_type === "DAY" ? "주간" : u.shift_type === "NIGHT" ? "야간" : u.shift_type ? String(u.shift_type) : "";

                const baseName = u.user_name ? u.user_name : `#${u.user_id}`;
                const displayName = u.user_id === 1 ? "대표" : baseName;

                const statusText = (() => {
                  if (!u.start_at || u.status === "NONE" || !u.status) return "미출근";
                  if (u.status === "LEAVE") return "월차";
                  if (u.status === "HALF_LEAVE") return "반차";
                  if (u.status === "EARLY_LEAVE") return `조퇴${shiftLabel ? "(" + shiftLabel + ")" : ""}`;
                  if (isWorking) return `근무중(${u.status === "OFFICE" ? "사무실" : "외근"}${shiftLabel ? "/" + shiftLabel : ""})`;
                  // 근무중이 아닌 경우
                  if (u.status === "OUTSIDE" || u.status === "TRIP_VIRTUAL") return `직퇴${shiftLabel ? "(" + shiftLabel + ")" : ""}`;
                  return `퇴근${shiftLabel ? "(" + shiftLabel + ")" : ""}`;
                })();

                const sessions = Array.isArray(u.sessions) ? u.sessions : [];
                const tooltip = sessions
                  .map((s) => {
                    const isLeaveSess = s.session_type === "LEAVE";
                    const start = isLeaveSess ? "-" : fmtDT_HM(s.start_at);
                    const end = isLeaveSess ? "-" : s.end_at ? fmtDT_HM(s.end_at) : "진행중";
                    const st = sessionTypeLabel(s.session_type);
                    const extra = [s.place, s.task].filter(Boolean).join(" / ");
                    return `${start}~${end} ${st}${extra ? " - " + extra : ""}`;
                  })
                  .join("\n");

                const isExpanded = !!expandedUserIds[u.user_id];
                const cols = 6 + (isAdmin ? 1 : 0) + 1;

                return (
                  <React.Fragment key={u.user_id}>
                    <tr style={{ borderTop: "1px solid rgba(255,255,255,.07)" }} className={isWorking ? "rowWorking" : "rowOff"}>
                      <td style={{ padding: "8px 6px" }}>{displayName}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <span className={`badge ${statusBadgeClass(u.status)} ${isWorking ? "badgeActive" : ""}`}>
                          {isWorking && <span className="dotPulse" />}
                          {statusText}
                        </span>
                      </td>
                      <td style={{ padding: "8px 6px" }}>{u.place || "-"}</td>
                      <td style={{ padding: "8px 6px" }}>{u.task || "-"}</td>
                      <td style={{ padding: "8px 6px" }}>
                        {u.status === "LEAVE" ? "" : fmtDT_HM(u.start_at)}
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        {u.status === "LEAVE" ? "" : fmtDT_HM(u.end_at)}
                      </td>
                      {isAdmin && <td style={{ padding: "8px 6px" }}>{fmtHM(u.worked_minutes)}</td>}
                      <td style={{ padding: "8px 6px" }}>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: "4px 8px" }}
                          title={tooltip || "세션 상세 없음"}
                          onClick={() => toggleExpand(u.user_id)}
                        >
                          {typeof u.session_count === "number" ? `${u.session_count}회` : "-"}
                          <span style={{ marginLeft: 6, opacity: 0.8 }}>{isExpanded ? "▲" : "▼"}</span>
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className={isWorking ? "rowWorking" : "rowOff"}>
                        <td colSpan={cols} style={{ padding: "10px 6px" }}>
                          {sessions.length === 0 ? (
                            <div className="small" style={{ color: "var(--muted)" }}>
                              세션 상세 정보가 없습니다.
                            </div>
                          ) : (
                            <div style={{ display: "grid", gap: 6 }}>
                              {sessions.map((s, idx) => {
                                const start = fmtDT_HM(s.start_at);
                                const end = s.end_at ? fmtDT_HM(s.end_at) : "진행중";
                                const st = sessionTypeLabel(s.session_type);
                                const stClass = sessionTypeClass(s.session_type);
                                const extra = [s.place, s.task].filter(Boolean).join(" / ");
                                return (
                                  <div key={idx} style={{ fontSize: 13 }}>
                                    <b>
                                      {start}~{end}
                                    </b>
                                    <span style={{ marginLeft: 8 }} className={`sessTag ${stClass}`}>
                                      {st}
                                    </span>
                                    {s.session_type !== "LEAVE" && s.session_type !== "HALF_LEAVE" && !s.end_at && (
                                      <span style={{ marginLeft: 6 }} className="sessTag sessTagRunning">
                                        진행중
                                      </span>
                                    )}
                                    {extra ? <span style={{ marginLeft: 8 }}>{extra}</span> : null}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {sortedTodayStatus.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="small" style={{ padding: "10px 6px" }}>
                    표시할 데이터가 없습니다.
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