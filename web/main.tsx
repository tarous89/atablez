import React, {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
} from "react";
import { createRoot } from "react-dom/client";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import {
  Table2,
  Plus,
  ArrowUpRight,
  Search,
  X,
  Check,
  MoreHorizontal,
  Download,
  Undo2,
  Trash2,
  AlignLeft,
  Columns3,
  LogOut,
  Settings as SettingsIcon,
  Users,
  Share2,
  Paperclip,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";
import type { Column, Table } from "../server/domain";
import "./style.css";
type RichTable = Table & { permission?: string };
type Workspace = {
  density?: string;
  name: string;
  id: string;
  homeId?: string;
  revision: number;
  expiresAt: number | null;
  tables: RichTable[];
  canUndo: boolean;
  role?: string;
  signedIn?: boolean;
  attachments?: any[];
};
const embedded = window.parent !== window;
let bridge: McpApp | undefined,
  auth = embedded ? "" : sessionStorage.getItem("atablez.auth") || "",
  apiBase = "";
let connectedToChat = false;
let pendingTool: any,
  onTool: (r: any) => void = (r) => {
    pendingTool = r;
  };
if (embedded) {
  bridge = new McpApp(
    { name: "AtableZ", version: "0.2.0" },
    {},
    { autoResize: true },
  );
  bridge.ontoolresult = (r) => onTool(r);
  bridge.connect().catch(() => {});
}
async function api(path: string, body?: any) {
  const r = await fetch(`${apiBase}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: r.status,
    });
  return data;
}
function setAuth(v: string) {
  auth = v;
  if (!embedded) sessionStorage.setItem("atablez.auth", v);
}
const uuid = () => crypto.randomUUID();
const newField = (): Column => ({
  id: "f_" + uuid().replaceAll("-", "").slice(0, 12),
  name: "New column",
  description: "",
  instruction: "",
  type: "string",
  required: false,
  options: [],
  fixed: false,
});
const colors = ["blue", "green", "amber", "violet", "rose"];
const typeNames: Record<string, string> = {
  string: "Text",
  text: "Long text",
  integer: "Integer",
  number: "Number",
  date: "Date",
  boolean: "Checkbox",
  select: "Choice",
  multiselect: "Multiple choice",
  url: "Link",
  progress: "Progress",
  rating: "Rating",
  image: "Image",
  files: "Files",
};
const DataContext = createContext<{
  w: Workspace | null;
  t?: RichTable;
  readonly: boolean;
}>({ w: null, readonly: false });
async function openExternal(url: string) {
  if (bridge) await bridge.openLink({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
function App() {
  const [w, setW] = useState<Workspace | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [workspaces, setWorkspaces] = useState<any[]>([]);
  const [page, setPage] = useState(
      location.pathname === "/settings" ? "settings" : "tables",
    ),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState(""),
    [query, setQuery] = useState(""),
    [structure, setStructure] = useState(false),
    [account, setAccount] = useState(false),
    [accountMode, setAccountMode] = useState("signup"),
    [share, setShare] = useState(false),
    [detail, setDetail] = useState<string | null>(null);
  const [sort, setSort] = useState<{ id: string; asc: boolean } | null>(null),
    [missing, setMissing] = useState(false),
    [widths, setWidths] = useState<Record<string, number>>({});
  const [time, setTime] = useState(Date.now()),
    [notice, setNotice] = useState("");
  const busy = useRef(false),
    ref = useRef(w);
  ref.current = w;
  const params = new URLSearchParams(location.search),
    ticket = params.get("connect"),
    invite = params.get("invite");
  const t = w?.tables.find((t) => t.id === selected),
    readonly = t?.permission === "viewer";
  function navigate(next: string) {
    setPage(next);
    if (!embedded) {
      history.pushState(
        {},
        "",
        (next === "settings" ? "/settings" : "/") + location.search,
      );
    }
  }
  async function list() {
    try {
      setWorkspaces(await api("workspaces"));
    } catch {}
  }
  async function refresh(id = ref.current?.id) {
    try {
      const next = await api(
        "workspace" + (id ? "?workspaceId=" + encodeURIComponent(id) : ""),
      );
      setW(next);
      setLoadError("");
    } catch (e: any) {
      if ([401, 410].includes(e.status)) {
        setW(null);
        setAuth("");
        setError(e.message);
      } else if ([403, 404].includes(e.status)) {
        setW(null);
        setSelected(null);
        setError("Access is no longer available.");
        await api("workspace")
          .then(setW)
          .catch(() => {});
        list();
      } else
        setLoadError("Could not refresh your tables. Retrying automatically…");
    }
  }
  function adopt(r: any) {
    if (r?._meta?.auth) {
      setAuth(r._meta.auth);
      connectedToChat = !!r._meta.accountConnected;
      apiBase = r._meta.apiBase || "";
      if (r._meta.state) {
        setW(r._meta.state);
        ref.current = r._meta.state;
      }
      setSelected(r._meta.selected || null);
      setPage("tables");
      setLoadError("");
      refresh(r._meta.state?.id);
      list();
    }
  }
  onTool = adopt;
  useEffect(() => {
    if (pendingTool) {
      adopt(pendingTool);
      pendingTool = null;
    }
    if (!embedded) {
      if (auth) {
        refresh();
        list();
      } else start();
    }
    const clock = setInterval(() => setTime(Date.now()), 1000);
    const pop = () =>
      setPage(location.pathname === "/settings" ? "settings" : "tables");
    window.addEventListener("popstate", pop);
    return () => {
      clearInterval(clock);
      window.removeEventListener("popstate", pop);
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        auth &&
        !busy.current &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        )
      ) {
        refresh();
        list();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (w?.expiresAt && time >= w.expiresAt) {
      setAuth("");
      setW(null);
      setError("This preview has expired. Start a new preview.");
    }
  }, [time, w?.expiresAt]);
  useEffect(() => {
    if (ticket && w?.expiresAt) setAccount(true);
  }, [ticket, w?.expiresAt]);
  async function start() {
    try {
      const g = await api("guest", {});
      setAuth(g.auth);
      setW(g.state);
      setError("");
      setLoadError("");
      list();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function change(op: any) {
    if (busy.current)
      throw new Error("Another change is saving. Try again in a moment.");
    busy.current = true;
    setStatus("Saving…");
    setError("");
    try {
      const next = await api("change", {
        ...op,
        workspaceId: ref.current?.id,
        revision: ref.current?.revision,
        requestId: uuid(),
      });
      setW(next);
      ref.current = next;
      setStatus("Saved");
      setLoadError("");
      return next;
    } catch (e: any) {
      setError(e.message);
      setStatus("Not saved");
      throw e;
    } finally {
      busy.current = false;
    }
  }
  const run = (fn: () => Promise<any>) => {
    fn().catch((e: any) => setError(e.message));
  };
  async function create(sample = false) {
    const fields: Column[] = sample
      ? [
          { ...newField(), id: "name", name: "Idea" },
          {
            ...newField(),
            id: "status",
            name: "Status",
            type: "select",
            options: ["Exploring", "In progress", "Ready"],
          },
          { ...newField(), id: "progress", name: "Progress", type: "progress" },
          { ...newField(), id: "link", name: "Link", type: "url" },
          { ...newField(), id: "notes", name: "Notes", type: "text" },
        ]
      : [
          { ...newField(), name: "Name" },
          { ...newField(), name: "Notes", type: "text" },
        ];
    const next = await change({
      action: "create",
      name: sample ? "Ideas to explore" : "Untitled table",
      fields,
      rows: sample
        ? [
            {
              name: "Plan a weekend away",
              status: "Exploring",
              progress: 20,
              notes: "Sample data — make it your own.",
            },
            {
              name: "Build a reading collection",
              status: "In progress",
              progress: 65,
            },
            { name: "Try something new", status: "Ready", progress: 100 },
          ]
        : [],
    });
    setSelected(next.result.tableId);
    setQuery("");
    list();
  }
  async function exportCsv() {
    if (!t) return;
    const safe = (v: any) => {
      let s = Array.isArray(v)
        ? v
            .map((id) => w?.attachments?.find((a) => a.id === id)?.name || id)
            .join("; ")
        : String(v ?? "");
      if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const data = [
      t.fields
        .map((f) => safe(f.name + (f.type === "progress" ? " (%)" : "")))
        .join(","),
      ...t.rows.map((r) => t.fields.map((f) => safe(r.values[f.id])).join(",")),
    ].join("\r\n");
    await download(
      new Blob([data], { type: "text/csv;charset=utf-8" }),
      t.name + ".csv",
    );
  }
  let rows =
    t?.rows.filter(
      (r) =>
        (!query ||
          Object.values(r.values).some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(query.toLowerCase()),
          )) &&
        (!missing ||
          t.fields.some(
            (f) =>
              f.required && (r.values[f.id] == null || r.values[f.id] === ""),
          )),
    ) || [];
  if (sort)
    rows = [...rows].sort((a, b) => {
      const x = a.values[sort.id],
        y = b.values[sort.id];
      return (
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x ?? "").localeCompare(String(y ?? ""))) *
        (sort.asc ? 1 : -1)
      );
    });
  return (
    <DataContext.Provider value={{ w, t, readonly: !!readonly }}>
      <header>
        <button
          className="brand"
          onClick={async () => {
            navigate("tables");
            setSelected(null);
            setQuery("");
          }}
          aria-label="AtableZ home"
        >
          <Table2 size={21} />
          <span>AtableZ</span>
        </button>
        <div className="workspace-nav">
          {w && w.role !== "viewer" && w.id === (w.homeId || w.id) ? (
            <Editable
              label="Workspace name"
              value={w.name}
              onSave={(name) => change({ action: "workspace", name })}
            />
          ) : (
            <span>{w?.name || "My workspace"}</span>
          )}
          {workspaces.length > 1 && (
            <select
              aria-label="Switch workspace"
              value={w?.id || ""}
              onChange={(e) => {
                setSelected(null);
                setQuery("");
                refresh(e.target.value);
              }}
            >
              {workspaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.shared ? " · Shared" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <nav>
          <button
            className={page === "tables" ? "active" : ""}
            onClick={async () => {
              navigate("tables");
              setSelected(null);
              setQuery("");
            }}
          >
            Tables
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            Settings
          </button>
        </nav>
        <div className="header-right">
          {!w?.signedIn && (
            <button
              className="text-button"
              onClick={async () => {
                setAccountMode("login");
                setAccount(true);
              }}
            >
              Sign in
            </button>
          )}
        </div>
      </header>
      {w?.expiresAt && (
        <div className="preview">
          <span>
            Preview expires in{" "}
            {Math.max(0, Math.ceil((w.expiresAt - time) / 60000))} min.
          </span>
          <button
            onClick={async () => {
              setAccountMode("signup");
              setAccount(true);
            }}
          >
            Keep my tables <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      {(error || loadError) && (
        <div className="error" role="alert">
          <span>{error || loadError}</span>
          <button
            onClick={async () => {
              setError("");
              refresh();
            }}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {ticket && (
        <div className="connection">
          <span>Use your saved and shared tables in ChatGPT.</span>
          <button
            className="primary"
            onClick={async () => {
              if (!w?.signedIn) setAccount(true);
              else
                run(async () => {
                  const x = await api("connect", { ticket });
                  location.assign(x.redirect);
                });
            }}
          >
            Connect account
          </button>
        </div>
      )}
      {invite && (
        <div className="connection">
          <span>{notice || "You’ve been invited to shared tables."}</span>
          {!notice && (
            <button
              className="primary"
              onClick={async () => {
                if (!w?.signedIn) setAccount(true);
                else
                  run(async () => {
                    const x = await api("invitation", { token: invite });
                    setNotice(x.message);
                  });
              }}
            >
              Request access
            </button>
          )}
        </div>
      )}
      {!w ? (
        <main className="empty">
          <Table2 size={32} />
          <h1>Your custom reusable database.</h1>
          <p>
            {embedded
              ? "Ask ChatGPT to save information as a table."
              : auth
                ? "Opening your tables…"
                : "Save something worth coming back to."}
          </p>
          {!embedded && !auth && (
            <button className="primary" onClick={start}>
              Start a preview
            </button>
          )}
        </main>
      ) : page === "settings" ? (
        <SettingsPage
          w={w}
          change={change}
          onAccount={() => setAccount(true)}
          onError={setError}
          onRefresh={() => refresh()}
          onLogout={() => {
            setW(null);
            setSelected(null);
            start();
          }}
        />
      ) : !t ? (
        <main className="home">
          <div className="page-heading">
            <h1>Tables</h1>
            {w.canUndo && !w.tables.length && (
              <button
                className="outline"
                onClick={() => run(() => change({ action: "undo" }))}
              >
                <Undo2 size={15} />
                Undo last change
              </button>
            )}
            {(!w.role || w.role !== "viewer") && (
              <button className="primary" onClick={() => run(() => create())}>
                <Plus size={16} />
                New table
              </button>
            )}
          </div>
          {w.tables.length > 3 && (
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Find a table"
                placeholder="Find a table"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          {w.tables.length ? (
            <div className="cards">
              {w.tables
                .filter((t) =>
                  t.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((table, i) => (
                  <button
                    className="table-card"
                    key={table.id}
                    onClick={async () => {
                      setSelected(table.id);
                      setQuery("");
                      setSort(null);
                    }}
                  >
                    <div className={"card-icon " + colors[i % colors.length]}>
                      <Table2 size={21} />
                    </div>
                    <div>
                      <h2>{table.name}</h2>
                      <p>
                        {table.rows.length}{" "}
                        {table.rows.length === 1 ? "row" : "rows"}
                        {table.permission === "viewer" ? " · Read only" : ""}
                      </p>
                    </div>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
            </div>
          ) : (
            <div className="welcome">
              <div className="welcome-grid">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <h2>A place for what you discover.</h2>
              <p>Ask ChatGPT to save a table, or start one here.</p>
              <button
                className="text-button"
                onClick={() => run(() => create(true))}
              >
                Explore a sample table <ArrowUpRight size={15} />
              </button>
            </div>
          )}
        </main>
      ) : (
        <main
          className={"table-page " + (w.density === "compact" ? "dense" : "")}
        >
          <div className="table-heading">
            <Editable
              className="table-title"
              label="Table name"
              value={t.name}
              disabled={readonly}
              onSave={(name) =>
                change({ action: "metadata", tableId: t.id, name })
              }
            />
            <div className="actions">
              {readonly && <span className="muted">Read only</span>}
              {w.role === "owner" && w.signedIn && (
                <button className="outline" onClick={() => setShare(true)}>
                  <Share2 size={15} />
                  Share
                </button>
              )}
              <details
                className="menu"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button"))
                    e.currentTarget.removeAttribute("open");
                }}
              >
                <summary aria-label="Table actions">
                  <MoreHorizontal size={21} />
                </summary>
                <div>
                  <button
                    onClick={() => setStructure(true)}
                    disabled={readonly}
                  >
                    <Columns3 size={15} />
                    Modify table
                  </button>
                  <button onClick={() => run(() => exportCsv())}>
                    <Download size={15} />
                    Export CSV
                  </button>
                  {w.canUndo && (
                    <button
                      onClick={() => run(() => change({ action: "undo" }))}
                    >
                      <Undo2 size={15} />
                      Undo last change
                    </button>
                  )}
                </div>
              </details>
            </div>
          </div>
          {(t.description || !readonly) && (
            <Editable
              className="description"
              label="Table description"
              value={t.description}
              placeholder="Add a description"
              disabled={readonly}
              onSave={(description) =>
                change({ action: "metadata", tableId: t.id, description })
              }
            />
          )}
          <div className="table-toolbar">
            <label className="search">
              <Search size={15} />
              <input
                aria-label="Search rows"
                placeholder="Search rows"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {t.fields.some((f) => f.required) && (
              <button
                className={"subtle " + (missing ? "active" : "")}
                onClick={() => setMissing(!missing)}
              >
                Missing values
              </button>
            )}
            <span className="save-status" aria-live="polite">
              {status}
            </span>
          </div>
          <div className="grid-wrap">
            <table
              style={{
                minWidth: t.fields.reduce(
                  (n, f) => n + (widths[f.id] || 190),
                  40,
                ),
              }}
            >
              <thead>
                <tr>
                  {t.fields.map((f) => (
                    <th
                      key={f.id}
                      style={{
                        width: widths[f.id] || 190,
                        minWidth: widths[f.id] || 190,
                      }}
                    >
                      <button
                        title={f.description || f.instruction || f.name}
                        onClick={() =>
                          setSort({
                            id: f.id,
                            asc: sort?.id === f.id ? !sort.asc : true,
                          })
                        }
                      >
                        {f.name}
                        {f.required && <span className="required">*</span>}
                        {sort?.id === f.id && (sort.asc ? " ↑" : " ↓")}
                      </button>
                      <span
                        className="resize-handle"
                        onPointerDown={(e) => {
                          const start = e.clientX,
                            initial = widths[f.id] || 190;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const node = e.currentTarget;
                          const move = (ev: PointerEvent) =>
                            setWidths((old) => ({
                              ...old,
                              [f.id]: Math.max(
                                110,
                                initial + ev.clientX - start,
                              ),
                            }));
                          const end = () => {
                            node.removeEventListener("pointermove", move);
                            node.removeEventListener("pointerup", end);
                          };
                          node.addEventListener("pointermove", move);
                          node.addEventListener("pointerup", end);
                        }}
                      />
                    </th>
                  ))}
                  <th className="end-cell" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      t.colorField
                        ? "colored-row " +
                          (() => {
                            const f = t.fields.find(
                              (f) => f.id === t.colorField,
                            );
                            const v = row.values[t.colorField!];
                            return (
                              f?.optionColors?.[v] ||
                              colors[
                                Math.max(0, f?.options.indexOf(v) ?? 0) %
                                  colors.length
                              ]
                            );
                          })()
                        : ""
                    }
                  >
                    {t.fields.map((f) => (
                      <td key={f.id}>
                        <Cell
                          field={f}
                          value={row.values[f.id]}
                          onSave={(value) =>
                            change({
                              action: "patch",
                              tableId: t.id,
                              rowId: row.id,
                              values: { [f.id]: value },
                            })
                          }
                        />
                      </td>
                    ))}
                    <td className="end-cell">
                      <button
                        title="Open entry"
                        onClick={() => setDetail(row.id)}
                      >
                        <ArrowUpRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="no-rows">
                {query || missing
                  ? "No matching rows."
                  : "Add your first row, or ask ChatGPT to fill this table."}
              </div>
            )}
            {!readonly && (
              <button
                className="add-row"
                onClick={() =>
                  run(() =>
                    change({ action: "add", tableId: t.id, rows: [{}] }),
                  )
                }
              >
                <Plus size={15} />
                Add row
              </button>
            )}
          </div>
          <div className="table-footer">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </div>
        </main>
      )}
      {structure && t && (
        <Structure
          table={t}
          onClose={() => setStructure(false)}
          onSave={(op) => change({ ...op, tableId: t.id })}
          onDelete={() =>
            change({ action: "deleteTable", tableId: t.id }).then(() => {
              setSelected(null);
              setStructure(false);
            })
          }
        />
      )}
      {detail && t && (
        <Modal title="Row details" onClose={() => setDetail(null)}>
          {t.fields.map((f) => (
            <div className="detail-field" key={f.id}>
              <label>{f.name}</label>
              {f.description && <small>{f.description}</small>}
              <Cell
                field={f}
                value={t.rows.find((r) => r.id === detail)?.values[f.id]}
                onSave={(value) =>
                  change({
                    action: "patch",
                    tableId: t.id,
                    rowId: detail,
                    values: { [f.id]: value },
                  })
                }
              />
            </div>
          ))}
          {!readonly && (
            <button
              className="text-button danger"
              onClick={async () => {
                if (await confirmAction("Delete this row?"))
                  run(() =>
                    change({
                      action: "deleteRow",
                      tableId: t.id,
                      rowId: detail,
                    }).then(() => setDetail(null)),
                  );
              }}
            >
              <Trash2 size={15} />
              Delete row
            </button>
          )}
        </Modal>
      )}
      {account && (
        <Account
          initialMode={accountMode}
          onClose={() => setAccount(false)}
          onDone={async () => {
            setAccount(false);
            const next = await api("workspace");
            setW(next);
            ref.current = next;
            setError("");
            setLoadError("");
            list();
          }}
        />
      )}
      {share && w && (
        <Modal
          title={"Share " + (t?.name || "workspace")}
          onClose={() => setShare(false)}
        >
          <SharingPanel tableId={t?.id} tables={w.tables} onError={setError} />
        </Modal>
      )}
    </DataContext.Provider>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const el = useRef<HTMLElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    el.current?.focus();
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = el.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", fn);
    return () => {
      document.removeEventListener("keydown", fn);
      prev?.focus();
    };
  }, []);
  return (
    <div className="overlay">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={el}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
function Editable({
  value,
  label,
  onSave,
  className = "",
  placeholder = "",
  disabled = false,
}: {
  value: string;
  label: string;
  onSave: (v: string) => Promise<any>;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value),
    [err, setErr] = useState("");
  const cancel = useRef(false);
  useEffect(() => {
    if (!err) setDraft(value);
  }, [value]);
  return (
    <div className={className}>
      <input
        aria-label={label}
        readOnly={disabled}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancel.current = true;
            setDraft(value);
            setErr("");
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (cancel.current) {
            cancel.current = false;
            return;
          }
          if (draft !== value)
            onSave(draft)
              .then(() => setErr(""))
              .catch((e) => setErr(e.message));
        }}
      />
      {err && <small className="field-error">{err}</small>}
    </div>
  );
}

// Host-safe confirmation; window.confirm is unavailable in the ChatGPT sandbox.
function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement;
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.style.zIndex = "100";
    const box = document.createElement("section");
    box.className = "modal";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Confirm change");
    const heading = document.createElement("div");
    heading.className = "modal-heading";
    const title = document.createElement("h2");
    title.textContent = "Confirm change";
    heading.append(title);
    const body = document.createElement("div");
    body.className = "modal-body";
    const text = document.createElement("p");
    text.textContent = message;
    body.append(text);
    const actions = document.createElement("div");
    actions.className = "modal-footer";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.className = "outline";
    const okay = document.createElement("button");
    okay.textContent = "Confirm";
    okay.className = "primary";
    const done = (value: boolean) => {
      overlay.remove();
      previous?.focus();
      resolve(value);
    };
    cancel.onclick = () => done(false);
    okay.onclick = () => done(true);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
      if (e.key === "Tab") {
        e.preventDefault();
        (document.activeElement === cancel ? okay : cancel).focus();
      }
    });
    actions.append(cancel, okay);
    box.append(heading, body, actions);
    overlay.append(box);
    document.body.append(overlay);
    cancel.focus();
  });
}

async function download(blob: Blob, name: string) {
  if (bridge) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const result = await bridge.downloadFile({
      contents: [
        {
          type: "resource",
          resource: {
            uri: "file:///" + encodeURIComponent(name),
            mimeType: blob.type,
            blob: btoa(binary),
          },
        },
      ],
    });
    if (result.isError) throw new Error("Download was cancelled.");
    return;
  }
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function fileBlob(x: any) {
  const bytes = Uint8Array.from(atob(x.data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: x.mime });
}
function Attachment({ id, image = false }: { id: string; image?: boolean }) {
  const { w } = useContext(DataContext),
    info = w?.attachments?.find((a) => a.id === id);
  const [src, setSrc] = useState(""),
    [err, setErr] = useState(""),
    [preview, setPreview] = useState(false);
  useEffect(() => {
    let live = true,
      url = "";
    if (image)
      api("attachments/" + id)
        .then((x) => {
          url = URL.createObjectURL(fileBlob(x));
          if (live) setSrc(url);
        })
        .catch((e) => {
          if (live) setErr(e.message);
        });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, image]);
  return (
    <>
      <button
        className={image ? "thumbnail" : "file-link"}
        title={info?.name || "File"}
        onClick={async () => {
          try {
            if (image && src) setPreview(true);
            else {
              const x = await api("attachments/" + id);
              await download(fileBlob(x), x.name);
            }
          } catch (e: any) {
            setErr(e.message);
          }
        }}
      >
        {image && src ? (
          <img src={src} alt={info?.name || "Attachment"} />
        ) : (
          <>
            <Paperclip size={14} />
            <span>{info?.name || "File"}</span>
          </>
        )}
      </button>
      {err && <small className="field-error">{err}</small>}
      {preview && (
        <Modal title={info?.name || "Image"} onClose={() => setPreview(false)}>
          <img className="image-preview" src={src} alt={info?.name || ""} />
        </Modal>
      )}
    </>
  );
}
function Cell({
  field: f,
  value,
  onSave,
}: {
  field: Column;
  value: any;
  onSave: (v: any) => Promise<any>;
}) {
  const { w, t, readonly } = useContext(DataContext),
    locked = readonly || f.fixed;
  const [draft, setDraft] = useState<any>(value ?? ""),
    [err, setErr] = useState(""),
    [uploading, setUploading] = useState(false);
  const cancel = useRef(false);
  useEffect(() => {
    if (!err) setDraft(value ?? "");
  }, [value]);
  async function commit(v: any) {
    try {
      await onSave(v);
      setErr("");
      setDraft(v ?? "");
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function upload(files: FileList | null) {
    if (!files || locked || !w || !t) return;
    setUploading(true);
    setErr("");
    try {
      const ids = [...(value || [])];
      for (const file of Array.from(files)) {
        if (file.size > 2 * 1024 * 1024)
          throw new Error("Files must be 2 MB or smaller");
        if (ids.length >= 10) throw new Error("Up to 10 files per cell");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const a = await api("attachments", {
          workspaceId: w.id,
          tableId: t.id,
          name: file.name,
          data: btoa(binary),
        });
        if (f.type === "image" && !a.mime.startsWith("image/"))
          throw new Error("Choose an image");
        ids.push(a.id);
      }
      await onSave(ids);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  }
  const numeric = ["integer", "number", "progress", "rating"].includes(f.type);
  const input = (
    <input
      aria-label={f.name}
      readOnly={locked}
      value={draft}
      type={f.type === "date" ? "date" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      className={numeric ? "numeric" : ""}
      placeholder=""
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancel.current = true;
          setDraft(value ?? "");
          setErr("");
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (cancel.current) {
          cancel.current = false;
          return;
        }
        let v = draft;
        if (v === "") v = null;
        else if (numeric) v = Number(v);
        if (v !== value && !(v === null && value === undefined)) commit(v);
      }}
    />
  );
  const tint =
    f.optionColors?.[value] ||
    colors[Math.max(0, f.options.indexOf(value)) % colors.length];
  return (
    <div className={"cell " + (locked ? "locked" : "")}>
      {f.type === "boolean" ? (
        <div className="check-cell">
          <input
            aria-label={f.name}
            type="checkbox"
            disabled={locked}
            checked={value === true}
            onChange={(e) => commit(e.target.checked)}
          />
        </div>
      ) : f.type === "select" ? (
        <select
          aria-label={f.name}
          disabled={locked}
          className={value ? "chip " + tint : "blank-choice"}
          value={value ?? ""}
          onChange={(e) => commit(e.target.value || null)}
        >
          <option value=""></option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : f.type === "multiselect" ? (
        <details className="multi-choice">
          <summary aria-label={f.name}>
            {(value || []).map((v: string) => (
              <span
                key={v}
                className={
                  "chip " +
                  (f.optionColors?.[v] ||
                    colors[Math.max(0, f.options.indexOf(v)) % colors.length])
                }
              >
                {v}
              </span>
            ))}
            {!value?.length && (
              <span className="muted">{locked ? "—" : "Choose"}</span>
            )}
          </summary>
          <div className="choice-options">
            {f.options.map((o) => (
              <label key={o}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={(value || []).includes(o)}
                  onChange={(e) =>
                    commit(
                      e.target.checked
                        ? [...(value || []), o]
                        : (value || []).filter((v: string) => v !== o),
                    )
                  }
                />
                {o}
              </label>
            ))}
          </div>
        </details>
      ) : f.type === "progress" ? (
        <div className="progress-cell">
          <div
            className={"progress-track " + (f.color || "blue")}
            role="progressbar"
            aria-label={f.name}
            aria-valuenow={value ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              style={{ width: Math.min(100, Math.max(0, value || 0)) + "%" }}
            />
          </div>
          {input}
          <span className="percent">{value != null ? "%" : ""}</span>
        </div>
      ) : f.type === "rating" ? (
        <div className="rating">
          <span aria-hidden="true">
            {"★".repeat(Math.min(f.max ?? 5, Math.max(0, value || 0)))}
            {"☆".repeat(Math.max(0, (f.max ?? 5) - (value || 0)))}
          </span>
          {input}
        </div>
      ) : ["image", "files"].includes(f.type) ? (
        <div
          className="file-cell"
          onDragOver={(e) => {
            if (!locked) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            upload(e.dataTransfer.files);
          }}
        >
          {(value || []).map((id: string) => (
            <div className="file-item" key={id}>
              <Attachment id={id} image={f.type === "image"} />
              {!locked && (
                <button
                  className="remove-file"
                  aria-label="Remove attachment"
                  onClick={() =>
                    commit((value || []).filter((x: string) => x !== id))
                  }
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
          {!locked && (
            <label className="upload-control" title="Upload file">
              <Plus size={14} />
              <input
                aria-label={"Upload " + f.name}
                type="file"
                multiple
                accept={
                  f.type === "image"
                    ? ".png,.jpg,.jpeg,.webp"
                    : ".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv,.docx,.xlsx"
                }
                disabled={uploading}
                onChange={(e) => {
                  upload(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {uploading && <small>Uploading…</small>}
        </div>
      ) : f.type === "url" ? (
        <div className="link-cell">
          {input}
          {value && /^https?:\/\//i.test(value) && (
            <button
              aria-label={"Open " + f.name}
              title={value}
              onClick={() =>
                openExternal(value).catch((e) => setErr(e.message))
              }
            >
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      ) : f.type === "text" ? (
        <textarea
          rows={1}
          aria-label={f.name}
          readOnly={locked}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancel.current = true;
              setDraft(value ?? "");
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            if (cancel.current) {
              cancel.current = false;
              return;
            }
            if (draft !== (value ?? "")) commit(draft || null);
          }}
        />
      ) : (
        input
      )}
      {err && (
        <small className="field-error">
          {err}{" "}
          <button
            onClick={async () => {
              setErr("");
              setDraft(value ?? "");
            }}
          >
            Reset
          </button>
        </small>
      )}
    </div>
  );
}
function SettingsPage({
  w,
  change,
  onAccount,
  onError,
  onRefresh,
  onLogout,
}: {
  w: Workspace;
  change: (v: any) => Promise<any>;
  onAccount: () => void;
  onError: (s: string) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState("workspace"),
    [account, setAccount] = useState<any>(null),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (w.signedIn)
      api("account")
        .then(setAccount)
        .catch((e) => onError(e.message));
  }, [w.signedIn]);
  const act = (fn: () => Promise<any>) => fn().catch((e) => onError(e.message));
  return (
    <main className="settings-page">
      <div className="page-heading">
        <h1>Settings</h1>
        {embedded && (
          <button
            className="text-button"
            onClick={() => act(() => openExternal(apiBase + "/settings"))}
          >
            Open in app <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      <div className="settings-tabs">
        {[
          ["workspace", "Workspace"],
          ["team", "Team & access"],
          ["account", "Account"],
        ].map(([id, title]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={async () => {
              setTab(id);
              setMessage("");
            }}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "workspace" ? (
        <section className="settings-section">
          <h2>Workspace</h2>
          <label className="form-label">
            Name
            <Editable
              value={w.name}
              label="Workspace settings name"
              disabled={w.role !== "owner"}
              onSave={(name) => change({ action: "workspace", name })}
            />
          </label>
          <label className="form-label">
            Row spacing
            <select
              aria-label="Row spacing"
              value={w.density || "comfortable"}
              disabled={w.role !== "owner"}
              onChange={(e) =>
                act(() =>
                  change({ action: "workspace", density: e.target.value }),
                )
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <div className="setting-row">
            <div>
              <strong>File storage</strong>
              <p>
                {(
                  (w.attachments || []).reduce((n, a) => n + a.size, 0) /
                  1048576
                ).toFixed(1)}{" "}
                MB used
                {w.role === "owner" ? ` of ${w.expiresAt ? 5 : 20} MB` : ""}
              </p>
            </div>
            {w.signedIn && w.role === "owner" && (
              <button
                className="outline"
                onClick={() =>
                  act(async () => {
                    const x = await api("attachments/cleanup", {});
                    setMessage(`${x.removed} unused uploads removed.`);
                    onRefresh();
                  })
                }
              >
                Remove unused uploads
              </button>
            )}
          </div>
          {w.signedIn && (
            <div className="setting-row">
              <div>
                <strong>ChatGPT</strong>
                <p>
                  {connectedToChat
                    ? "Your account is connected for this conversation."
                    : "Connect AtableZ in ChatGPT to use your saved and shared tables."}
                </p>
              </div>
            </div>
          )}
          {message && (
            <p className="success" role="status">
              {message}
            </p>
          )}
        </section>
      ) : tab === "team" ? (
        w.signedIn && w.id === w.homeId ? (
          <SharingPanel tables={w.tables} onError={onError} />
        ) : (
          <section className="settings-section">
            <p>
              {w.signedIn
                ? "Switch to your own workspace to manage your team."
                : "Create an account to share tables with your team."}
            </p>
            {!w.signedIn && (
              <button className="primary" onClick={onAccount}>
                Create an account
              </button>
            )}
          </section>
        )
      ) : (
        <section className="settings-section">
          {!w.signedIn ? (
            <>
              <h2>Keep your tables</h2>
              <p>
                Create an account to keep your tables and access them in future
                conversations.
              </p>
              <button className="primary" onClick={onAccount}>
                Create an account
              </button>
            </>
          ) : (
            <>
              <h2>{account?.email || "Your account"}</h2>
              <details className="password-settings">
                <summary>Change password</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      await api("account/password", { current, password });
                      setCurrent("");
                      setPassword("");
                      setMessage(
                        "Password changed. Other sessions have been signed out.",
                      );
                    });
                  }}
                >
                  <label className="form-label">
                    Current password
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                      required
                    />
                  </label>
                  <label className="form-label">
                    New password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </label>
                  <button className="primary">Save password</button>
                </form>
              </details>
              {message && <p className="success">{message}</p>}
              <button
                className="text-button"
                onClick={() =>
                  act(async () => {
                    await api("auth/logout", {});
                    setAuth("");
                    onLogout();
                  })
                }
              >
                <LogOut size={15} />
                Sign out
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}
function SharingPanel({
  tableId,
  tables,
  onError,
}: {
  tableId?: string;
  tables: Table[];
  onError: (s: string) => void;
}) {
  const [data, setData] = useState<any>({
      teams: [],
      members: [],
      grants: [],
      invitations: [],
    }),
    [scope, setScope] = useState(tableId || "*"),
    [role, setRole] = useState("viewer"),
    [team, setTeam] = useState(""),
    [name, setName] = useState(""),
    [link, setLink] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState("");
  async function load() {
    setData(await api("sharing"));
  }
  useEffect(() => {
    load().catch((e) => setLocalError(e.message));
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);
  async function act(body: any) {
    setBusy(true);
    setLocalError("");
    try {
      const x = await api("sharing", body);
      await load();
      return x;
    } catch (e: any) {
      setLocalError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const scopeName = (id: string) =>
    id === "*"
      ? "Entire workspace"
      : tables.find((t) => t.id === id)?.name || "Deleted table";
  const roleSelect = (
    value: string,
    fn: (s: string) => void,
    label: string,
  ) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => fn(e.target.value)}
    >
      <option value="viewer">Can view</option>
      <option value="editor">Can edit</option>
    </select>
  );
  return (
    <section className="sharing-panel">
      <h2>Share access</h2>
      <div className="share-controls">
        <label className="form-label">
          What to share
          <select
            aria-label="Share scope"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setLink("");
            }}
          >
            <option value="*">Entire workspace</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Access{roleSelect(role, setRole, "Invitation permission")}
        </label>
      </div>
      <div className="share-controls">
        <label className="form-label">
          Who
          <select
            aria-label="Share with"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Invite a person</option>
            {data.teams.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            if (team) {
              const x = await act({
                action: "grantTeam",
                teamId: team,
                tableId: scope,
                role,
              });
              if (x) setMessage("Team access saved.");
            } else {
              const x = await act({ action: "invite", tableId: scope, role });
              if (x) setLink(x.url);
            }
          }}
        >
          {team ? "Give team access" : "Create invite link"}
        </button>
      </div>
      {!team && (
        <p className="help">
          Send the link to your teammate. After they sign in and request access,
          approve their account below.
        </p>
      )}
      {link && (
        <div className="invite-link">
          <input
            aria-label="Invite link"
            value={link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button
            className="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setMessage("Link copied.");
              } catch {
                (
                  document.querySelector(
                    'input[aria-label="Invite link"]',
                  ) as HTMLInputElement
                )?.select();
                setMessage("Select the link and copy it.");
              }
            }}
          >
            Copy link
          </button>
        </div>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {localError && (
        <p className="error" role="alert">
          {localError}
        </p>
      )}
      {!!data.invitations.length && (
        <>
          <h3>Invitations</h3>
          {data.invitations.map((i: any) => (
            <div className="access-row" key={i.id}>
              <div>
                <strong>
                  {i.status === "requested" ? i.email : "Waiting for a request"}
                </strong>
                <small>
                  {i.team_id
                    ? data.teams.find((t: any) => t.id === i.team_id)?.name
                    : scopeName(i.table_id)}{" "}
                  ·{" "}
                  {i.team_id
                    ? "Team member"
                    : i.role === "editor"
                      ? "Can edit"
                      : "Can view"}
                </small>
                {i.status === "requested" && (
                  <small>
                    Account {i.applicant.slice(0, 8)} · Confirm this is your
                    teammate.
                  </small>
                )}
              </div>
              {i.status === "requested" && (
                <button
                  className="outline"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmAction(
                        `Give access to ${i.email} (account ${i.applicant.slice(0, 8)})? Confirm this account with your teammate before approving.`,
                      )
                    )
                      act({ action: "approve", id: i.id });
                  }}
                >
                  Approve
                </button>
              )}
              <button
                className="subtle"
                disabled={busy}
                onClick={() => act({ action: "cancel", id: i.id })}
              >
                Cancel
              </button>
            </div>
          ))}
        </>
      )}
      {!!data.grants.length && (
        <>
          <h3>People with access</h3>
          {data.grants.map((g: any) => (
            <div className="access-row" key={g.id}>
              <div>
                <strong>{g.email || g.team_name || "Team"}</strong>
                <small>
                  {scopeName(g.table_id)}
                  {g.subject_type === "team"
                    ? " · Inherited by team members"
                    : ""}
                </small>
              </div>
              {roleSelect(
                g.role,
                (r) => act({ action: "role", id: g.id, role: r }),
                "Access for " + (g.email || g.team_name),
              )}
              <button
                className="subtle danger"
                disabled={busy}
                onClick={() => act({ action: "revoke", id: g.id })}
              >
                Remove
              </button>
            </div>
          ))}
        </>
      )}
      <h3>Teams</h3>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          act({ action: "team", name }).then((x) => {
            if (x) setName("");
          });
        }}
      >
        <input
          aria-label="Team name"
          placeholder="Team name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
        />
        <button className="outline" disabled={busy}>
          Create team
        </button>
      </form>
      {data.teams.map((t: any) => (
        <div className="team-card" key={t.id}>
          <div className="access-row">
            <Editable
              value={t.name}
              label="Rename team"
              onSave={async (name) => {
                const x = await act({ action: "team", id: t.id, name });
                if (!x) throw new Error("Could not rename team");
              }}
            />
            <button
              className="outline"
              disabled={busy}
              onClick={async () => {
                const x = await act({
                  action: "invite",
                  teamId: t.id,
                  role: "viewer",
                });
                if (x) setLink(x.url);
              }}
            >
              <Plus size={14} />
              Invite member
            </button>
            <button
              className="subtle danger"
              title="Delete team"
              onClick={async () => {
                if (
                  await confirmAction("Delete this team and its shared access?")
                )
                  act({ action: "deleteTeam", id: t.id });
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
          {data.members
            .filter((m: any) => m.team_id === t.id)
            .map((m: any) => (
              <div className="access-row" key={m.id}>
                <span>{m.email}</span>
                <button
                  className="subtle"
                  onClick={() =>
                    act({ action: "removeMember", teamId: t.id, userId: m.id })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          {!data.members.some((m: any) => m.team_id === t.id) && (
            <small className="muted">No members yet.</small>
          )}
        </div>
      ))}
    </section>
  );
}
function Account({
  initialMode,
  onClose,
  onDone,
}: {
  initialMode: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState(initialMode),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={mode === "signup" ? "Keep your tables" : "Welcome back"}
      onClose={onClose}
    >
      <p className="account-copy">
        {mode === "signup"
          ? "Save your tables and use them in any conversation."
          : "Sign in to access your saved and shared tables."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const x = await api("auth/" + mode, { email, password });
            setAuth(x.auth);
            onDone();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="form-label">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="form-label">
          Password
          <div className="password-input">
            <input
              aria-label="Password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={128}
            />
            <button type="button" onClick={() => setShow(!show)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>
      <button
        className="text-button full"
        onClick={async () => {
          setMode(mode === "signup" ? "login" : "signup");
          setError("");
        }}
      >
        {mode === "signup"
          ? "Already have an account? Sign in"
          : "New here? Create an account"}
      </button>
    </Modal>
  );
}
function Structure({
  table,
  onClose,
  onSave,
  onDelete,
}: {
  table: Table;
  onClose: () => void;
  onSave: (op: any) => Promise<any>;
  onDelete: () => Promise<any>;
}) {
  const { w } = useContext(DataContext);
  const [fields, setFields] = useState(structuredClone(table.fields));
  const [instructions, setInstructions] = useState(table.instructions);
  const [colorField, setColorField] = useState(table.colorField || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("columns");
  const changed =
    JSON.stringify(fields) !== JSON.stringify(table.fields) ||
    instructions !== table.instructions ||
    colorField !== (table.colorField || "");
  const removed = table.fields.filter(
    (f) => !fields.some((n) => n.id === f.id),
  );
  const destructive =
    removed.length > 0 ||
    fields.some(
      (f) =>
        f.fixed &&
        table.rows.some(
          (r) =>
            JSON.stringify(r.values[f.id] ?? null) !==
            JSON.stringify(f.fixedValue ?? null),
        ),
    );
  function edit(id: string, patch: Partial<Column>) {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  async function close() {
    if (!changed || (await confirmAction("Discard unsaved structure changes?")))
      onClose();
  }
  async function save() {
    if (
      destructive &&
      table.rows.length &&
      !(await confirmAction(
        `This change affects ${table.rows.length} entries.${removed.length ? " Removed columns: " + removed.map((f) => f.name).join(", ") + "." : ""} Review this before continuing.`,
      ))
    )
      return;
    setSaving(true);
    try {
      await onSave({
        action: "structure",
        fields,
        instructions,
        confirmRemoval: destructive,
        colorField,
      });
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="overlay">
      <section className="modal structure">
        <div className="modal-heading">
          <div>
            <h2>Modify table</h2>
          </div>
          <button aria-label="Close structure" onClick={close}>
            <X />
          </button>
        </div>
        <div className="modal-tabs">
          <button
            className={tab === "columns" ? "active" : ""}
            onClick={() => setTab("columns")}
          >
            <Columns3 size={15} />
            Columns <span>{fields.length}</span>
          </button>
          <button
            className={tab === "instructions" ? "active" : ""}
            onClick={() => setTab("instructions")}
          >
            <AlignLeft size={15} />
            Table instructions
          </button>
        </div>
        <div className="modal-body">
          {tab === "instructions" ? (
            <>
              <label className="form-label">
                How should this table be filled?
                <textarea
                  rows={8}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="For example: Use only information from the conversation. Leave unknown values blank. Prices should be in euros."
                />
              </label>
              <p className="help">
                These instructions are saved with the table and provided to
                ChatGPT when it retrieves your template.
              </p>
            </>
          ) : (
            <>
              <p className="help">
                Rename, reorder, or remove any column. For numbering, add an
                Integer column; its name and values are yours to edit.
              </p>
              <label className="form-label">
                Row colour
                <select
                  aria-label="Row colour"
                  value={colorField}
                  onChange={(e) => setColorField(e.target.value)}
                >
                  <option value="">None</option>
                  {fields
                    .filter((f) => f.type === "select")
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </label>
              {fields.map((f, i) => (
                <section className="column-card" key={f.id}>
                  <div className="column-number">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="column-config">
                    <div className="column-top">
                      <label className="form-label">
                        Column name
                        <input
                          aria-label={`Column ${i + 1} name`}
                          value={f.name}
                          onChange={(e) => edit(f.id, { name: e.target.value })}
                        />
                      </label>
                      <label className="form-label">
                        Data type
                        <select
                          aria-label={`Column ${i + 1} type`}
                          value={f.type}
                          onChange={(e) =>
                            edit(f.id, {
                              type: e.target.value as Column["type"],
                            })
                          }
                        >
                          {[
                            "string",
                            "text",
                            "integer",
                            "number",
                            "date",
                            "boolean",
                            "select",
                            "url",
                            "multiselect",
                            "progress",
                            "rating",
                            "image",
                            "files",
                          ].map((x) => (
                            <option key={x} value={x}>
                              {typeNames[x]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="subtle"
                        aria-label={`Move column ${i + 1} left`}
                        disabled={i === 0}
                        onClick={() =>
                          setFields((fs) => {
                            const next = [...fs];
                            [next[i - 1], next[i]] = [next[i], next[i - 1]];
                            return next;
                          })
                        }
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        className="subtle"
                        aria-label={`Move column ${i + 1} right`}
                        disabled={i === fields.length - 1}
                        onClick={() =>
                          setFields((fs) => {
                            const next = [...fs];
                            [next[i], next[i + 1]] = [next[i + 1], next[i]];
                            return next;
                          })
                        }
                      >
                        →
                      </button>
                      <button
                        className="remove-column"
                        title="Remove column"
                        disabled={fields.length === 1}
                        onClick={() =>
                          setFields((fs) => fs.filter((x) => x.id !== f.id))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <label className="form-label">
                      Description
                      <input
                        aria-label={`Column ${i + 1} description`}
                        value={f.description}
                        onChange={(e) =>
                          edit(f.id, { description: e.target.value })
                        }
                        placeholder="What does this column contain?"
                      />
                    </label>
                    <label className="form-label">
                      Instructions for ChatGPT
                      <textarea
                        aria-label={`Column ${i + 1} instructions`}
                        rows={2}
                        value={f.instruction}
                        onChange={(e) =>
                          edit(f.id, { instruction: e.target.value })
                        }
                        placeholder="Describe how ChatGPT should fill this column…"
                      />
                    </label>
                    {["select", "multiselect"].includes(f.type) && (
                      <label className="form-label">
                        Choices (one per line)
                        <textarea
                          value={f.options.join("\n")}
                          onChange={(e) =>
                            edit(f.id, { options: e.target.value.split("\n") })
                          }
                        />
                      </label>
                    )}
                    {["select", "multiselect"].includes(f.type) && (
                      <div className="option-colors">
                        {f.options.filter(Boolean).map((o, index) => (
                          <label key={index}>
                            {o}
                            <select
                              aria-label={o + " colour"}
                              value={
                                f.optionColors?.[o] ||
                                colors[index % colors.length]
                              }
                              onChange={(e) =>
                                edit(f.id, {
                                  optionColors: {
                                    ...f.optionColors,
                                    [o]: e.target.value as any,
                                  },
                                })
                              }
                            >
                              {colors.map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    )}
                    {f.type === "progress" && (
                      <label className="form-label">
                        Bar colour
                        <select
                          value={f.color || "blue"}
                          onChange={(e) =>
                            edit(f.id, { color: e.target.value as any })
                          }
                        >
                          {colors.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {f.type === "rating" && (
                      <label className="form-label">
                        Maximum rating
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={f.max ?? 5}
                          onChange={(e) =>
                            edit(f.id, { max: Number(e.target.value) })
                          }
                        />
                      </label>
                    )}
                    <div className="column-options">
                      <label>
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) =>
                            edit(f.id, { required: e.target.checked })
                          }
                        />
                        Required
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={f.fixed}
                          onChange={(e) =>
                            edit(f.id, { fixed: e.target.checked })
                          }
                        />
                        Fixed value
                      </label>
                      <button
                        disabled={i === 0}
                        onClick={() =>
                          setFields((fs) => {
                            const n = [...fs];
                            [n[i - 1], n[i]] = [n[i], n[i - 1]];
                            return n;
                          })
                        }
                      >
                        Move up
                      </button>
                    </div>
                    {f.fixed && (
                      <label className="form-label">
                        Value for every entry
                        <input
                          value={
                            Array.isArray(f.fixedValue)
                              ? f.fixedValue.join(", ")
                              : (f.fixedValue ?? "")
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            edit(f.id, {
                              fixedValue:
                                v === ""
                                  ? null
                                  : [
                                        "integer",
                                        "number",
                                        "progress",
                                        "rating",
                                      ].includes(f.type)
                                    ? Number(v)
                                    : f.type === "boolean"
                                      ? v === "true"
                                      : [
                                            "image",
                                            "files",
                                            "multiselect",
                                          ].includes(f.type)
                                        ? v
                                            .split(",")
                                            .map((x) => x.trim())
                                            .filter(Boolean)
                                        : v,
                            });
                          }}
                          placeholder={
                            f.type === "boolean"
                              ? "true or false"
                              : "Fixed value"
                          }
                        />
                      </label>
                    )}
                  </div>
                </section>
              ))}
              <button
                className="outline"
                onClick={() => setFields((fs) => [...fs, newField()])}
              >
                <Plus size={15} />
                Add column
              </button>
            </>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            className="text-button danger"
            disabled={w?.role !== "owner"}
            onClick={async () => {
              if (
                await confirmAction(
                  "Delete this table and all its entries? You can undo this change.",
                )
              )
                onDelete().catch((e) => setError(e.message));
            }}
          >
            <Trash2 size={14} />
            Delete table
          </button>
          <div>
            <button className="subtle" onClick={close}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={saving || !changed}
              onClick={save}
            >
              {saving ? "Saving…" : "Save structure"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
