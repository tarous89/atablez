import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import {
  Table2,
  Plus,
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  ArrowLeft,
  Clock3,
  X,
  Check,
  ChevronRight,
  MoreHorizontal,
  Download,
  Undo2,
  Trash2,
  AlignLeft,
  Columns3,
  LogOut,
} from "lucide-react";
import type { Column, Table } from "../server/domain";
import "./style.css";
type Workspace = {
  id: string;
  revision: number;
  expiresAt: number | null;
  tables: Table[];
  canUndo: boolean;
};
const embedded = window.parent !== window;
let bridge: McpApp | undefined;
let auth = embedded ? "" : sessionStorage.getItem("atablez.auth") || "";
let apiBase = "";
let pendingTool: any;
let onTool: (result: any) => void = (r) => {
  pendingTool = r;
};
if (embedded) {
  bridge = new McpApp(
    { name: "AtableZ", version: "0.1.0" },
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
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: r.status,
    });
  return data;
}
function setAuth(value: string) {
  auth = value;
  if (!embedded) sessionStorage.setItem("atablez.auth", value);
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
function App() {
  const [w, setW] = useState<Workspace | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("All changes saved");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [structure, setStructure] = useState(false);
  const [account, setAccount] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [sort, setSort] = useState<{ id: string; asc: boolean } | null>(null);
  const [time, setTime] = useState(Date.now());
  const [connectName, setConnectName] = useState("");
  const [filter, setFilter] = useState("");
  const busy = useRef(false);
  const ref = useRef(w);
  ref.current = w;
  const ticket = new URLSearchParams(location.search).get("connect");
  function adopt(result: any) {
    if (result?._meta?.auth) {
      setAuth(result._meta.auth);
      apiBase = result._meta.apiBase || "";
      api("workspace")
        .then(setW)
        .catch((e) => setError(e.message));
      setSelected(result._meta.selected || null);
      setStatus("All changes saved");
    }
  }
  onTool = adopt;
  useEffect(() => {
    if (pendingTool) {
      adopt(pendingTool);
      pendingTool = null;
    }
  }, []);
  async function refresh() {
    try {
      const state = await api("workspace");
      setW(state);
      setError("");
    } catch (e: any) {
      if (e.status === 410) {
        setW(null);
        setError(e.message);
        setAuth("");
      } else setError(e.message);
    }
  }
  useEffect(() => {
    if (!embedded) {
      if (auth) refresh();
      else
        api("guest", {})
          .then((g) => {
            setAuth(g.auth);
            setW(g.state);
          })
          .catch((e) => setError(e.message));
    }
    if (ticket)
      api(`connect?ticket=${encodeURIComponent(ticket)}`)
        .then((x) => setConnectName(x.clientName))
        .catch((e) => setError(e.message));
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        auth &&
        !busy.current &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName || "",
        )
      )
        api("workspace")
          .then((next) => {
            if (
              next.revision !== ref.current?.revision ||
              next.expiresAt !== ref.current?.expiresAt
            )
              setW(next);
          })
          .catch((e) => {
            if (e.status === 410) {
              setError(e.message);
              setW(null);
              setAuth("");
            }
          });
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  async function change(op: any) {
    if (busy.current)
      throw new Error("Another change is saving. Try again in a moment.");
    busy.current = true;
    setStatus("Saving…");
    setError("");
    try {
      const next = await api("change", {
        ...op,
        revision: ref.current?.revision,
        requestId: uuid(),
      });
      setW(next);
      ref.current = next;
      setStatus("All changes saved");
      return next;
    } catch (e: any) {
      setError(e.message);
      setStatus("Changes not saved");
      throw e;
    } finally {
      busy.current = false;
    }
  }
  const t = w?.tables.find((t) => t.id === selected);
  const minutes = w?.expiresAt
    ? Math.max(0, Math.ceil((w.expiresAt - time) / 60000))
    : 0;
  const expired = !!w?.expiresAt && time >= w.expiresAt;
  useEffect(() => {
    if (w?.expiresAt && time >= w.expiresAt) {
      setAuth("");
      setW(null);
      setError("This one-hour preview has expired. Start a new preview.");
    }
  }, [time, w?.expiresAt]);
  async function create(sample = false) {
    const fields: Column[] = sample
      ? [
          { ...newField(), id: "company", name: "Company" },
          { ...newField(), id: "country", name: "Country" },
          { ...newField(), id: "price", name: "Price (€)", type: "number" },
          {
            ...newField(),
            id: "status",
            name: "Status",
            type: "select",
            options: ["Researching", "Shortlisted", "Contacted"],
          },
          { ...newField(), id: "notes", name: "Notes", type: "text" },
        ]
      : [
          { ...newField(), name: "Name" },
          { ...newField(), name: "Description", type: "text" },
        ];
    const rows = sample
      ? [
          {
            company: "Northline Studio",
            country: "Germany",
            price: 2400,
            status: "Shortlisted",
            notes: "Illustrative data — replace with your own.",
          },
          {
            company: "Forma & Co.",
            country: "Netherlands",
            price: 3100,
            status: "Researching",
            notes: "Illustrative data — replace with your own.",
          },
          {
            company: "Atelier Olive",
            country: "France",
            price: 1800,
            status: "Contacted",
            notes: "Illustrative data — replace with your own.",
          },
        ]
      : [];
    const next = await change({
      action: "create",
      name: sample ? "Supplier shortlist" : "Untitled table",
      description: sample
        ? "A sample table to explore. All entries are fictional."
        : "",
      fields,
      rows,
    });
    setSelected(next.result.tableId);
  }
  function exportCsv() {
    if (!t) return;
    const safe = (v: any) => {
      let text = String(v ?? "");
      if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const body = [
      t.fields.map((f) => safe(f.name)).join(","),
      ...t.rows.map((r) => t.fields.map((f) => safe(r.values[f.id])).join(",")),
    ].join("\r\n");
    const u = URL.createObjectURL(
      new Blob([body], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = t.name.replace(/[^\w -]/g, "_") + ".csv";
    a.click();
    URL.revokeObjectURL(u);
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
        (!filter ||
          t.fields.some(
            (f) =>
              f.required &&
              (r.values[f.id] === null ||
                r.values[f.id] === undefined ||
                r.values[f.id] === ""),
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
    <>
      <header>
        <button
          className="brand"
          onClick={() => {
            setSelected(null);
            setQuery("");
          }}
        >
          <span className="brand-icon">
            <Table2 size={20} />
          </span>
          Atable<span>Z</span>
        </button>
        <span className="nav-divider" />
        <button
          className={"nav-link " + (!t ? "active" : "")}
          onClick={() => setSelected(null)}
        >
          My tables
        </button>
        {t && (
          <>
            <ChevronRight size={14} className="muted" />
            <span className="crumb">{t.name}</span>
          </>
        )}
        <div className="header-right">
          <span className="save-status">
            <Check size={13} />
            {status}
          </span>
          <button className="account-btn" onClick={() => setAccount(true)}>
            {w && !w.expiresAt ? "My account" : "Sign up"}
            <ArrowUpRight size={14} />
          </button>
        </div>
      </header>
      {w?.expiresAt && (
        <div className={"preview " + (expired ? "expired" : "")}>
          <Clock3 size={15} />
          <span>
            {expired
              ? "Your one-hour preview has expired."
              : "This preview is available for one hour."}
            <span className="countdown"> {minutes} min remaining</span>
          </span>
          <button onClick={() => setAccount(true)} disabled={expired}>
            Sign up to store it in your account <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
          <button
            onClick={() => {
              setError("");
              if (auth) refresh();
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {ticket && connectName && (
        <div className="connection">
          <span>
            Connect <strong>{connectName}</strong> to your AtableZ tables.
          </span>
          <button
            className="primary"
            onClick={async () => {
              if (!w || w.expiresAt) {
                setAccount(true);
                return;
              }
              try {
                const x = await api("connect", { ticket });
                location.assign(x.redirect);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            {w && !w.expiresAt ? "Allow connection" : "Sign in to connect"}
          </button>
        </div>
      )}
      {!w ? (
        <main className="empty">
          <Table2 size={40} />
          <h1>
            {error
              ? "Start fresh"
              : "Your tables, right beside the conversation."}
          </h1>
          <p>
            {embedded
              ? "Ask ChatGPT to save your information as a table in AtableZ."
              : "Preparing your workspace…"}
          </p>
          {!embedded && error && (
            <button
              className="primary"
              onClick={() =>
                api("guest", {}).then((g) => {
                  setAuth(g.auth);
                  setW(g.state);
                  setError("");
                })
              }
            >
              Start a new one-hour preview
            </button>
          )}
        </main>
      ) : !t ? (
        <main className="home">
          <div className="eyebrow">YOUR WORKSPACE</div>
          <div className="home-title">
            <div>
              <h1>
                My tables<span className="total">{w.tables.length}</span>
              </h1>
              <p>A place for everything worth keeping.</p>
            </div>
            <div className="home-actions">
              <button
                className="subtle"
                title="Undo last change"
                disabled={!w.canUndo}
                onClick={() => change({ action: "undo" }).catch(() => {})}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="primary"
                disabled={expired}
                onClick={() => create().catch(() => {})}
              >
                <Plus size={16} />
                New table
              </button>
            </div>
          </div>
          <div className="home-toolbar">
            <label className="search">
              <Search size={16} />
              <input
                placeholder="Find a table…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <span className="muted">Recently updated</span>
          </div>
          <div className="cards">
            {[...w.tables]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .filter((t) =>
                t.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((table) => (
                <button
                  className="table-card"
                  key={table.id}
                  onClick={() => {
                    setSelected(table.id);
                    setQuery("");
                    setFilter("");
                    setSort(null);
                  }}
                >
                  <span className="card-icon">
                    <Table2 size={21} />
                  </span>
                  <h2>{table.name}</h2>
                  <p>
                    {table.description ||
                      "Your information, organized your way."}
                  </p>
                  <div className="card-footer">
                    <span>
                      {table.rows.length} entries · {table.fields.length}{" "}
                      columns
                    </span>
                    <ArrowUpRight size={16} />
                  </div>
                </button>
              ))}
          </div>
          {!w.tables.length && (
            <section className="welcome">
              <div className="tiny-grid">
                <Table2 size={40} />
              </div>
              <h2>From a conversation to a collection.</h2>
              <p>
                Ask ChatGPT to “save this as a table.”
                <br />
                Or create your first table here and make it your own.
              </p>
              <button
                className="primary"
                onClick={() => create().catch(() => {})}
              >
                <Plus size={16} />
                Create a table
              </button>
              <button
                className="text-button"
                onClick={() => create(true).catch(() => {})}
              >
                Explore a sample table <ArrowUpRight size={14} />
              </button>
              <div className="sample-note">
                No setup wizard. Just start with what you have.
              </div>
            </section>
          )}
        </main>
      ) : (
        <main className="table-page">
          <div className="eyebrow">
            <Table2 size={13} /> TABLE
          </div>
          <div className="title-row">
            <Editable
              value={t.name}
              label="Table name"
              className="table-title"
              onSave={(name) =>
                change({ action: "metadata", tableId: t.id, name })
              }
            />
            <button
              className="subtle"
              onClick={() => change({ action: "undo" }).catch(() => {})}
              disabled={!w.canUndo}
              title="Undo last change"
            >
              <Undo2 size={16} />
            </button>
          </div>
          <Editable
            value={t.description}
            label="Table description"
            placeholder="Add a description…"
            className="description"
            onSave={(description) =>
              change({ action: "metadata", tableId: t.id, description })
            }
          />
          <div className="table-toolbar">
            <span className="view-label">
              <Table2 size={15} />
              Table view
            </span>
            <span className="row-count">{rows.length} entries</span>
            <div className="toolbar-right">
              <label className="search compact">
                <Search size={15} />
                <input
                  placeholder="Search entries…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button
                className={"subtle " + (filter ? "selected" : "")}
                onClick={() => setFilter(filter ? "" : "missing")}
                title="Show entries missing required values"
              >
                <SlidersHorizontal size={15} />
                <span>{filter ? "Incomplete" : "Filter"}</span>
              </button>
              <button className="subtle" onClick={exportCsv} title="Export CSV">
                <Download size={15} />
              </button>
              <button className="outline" onClick={() => setStructure(true)}>
                <Columns3 size={15} />
                Modify table
              </button>
            </div>
          </div>
          <div className="grid-wrap">
            <table>
              <thead>
                <tr>
                  <th className="index-cell">#</th>
                  {t.fields.map((f) => (
                    <th key={f.id}>
                      <button
                        title={f.description || f.instruction || f.name}
                        onClick={() =>
                          setSort({
                            id: f.id,
                            asc: sort?.id === f.id ? !sort.asc : true,
                          })
                        }
                      >
                        <span className="type-symbol">
                          {["integer", "number"].includes(f.type)
                            ? "#"
                            : f.type === "boolean"
                              ? "☑"
                              : "Aa"}
                        </span>
                        {f.name}
                        {f.required && <span className="required">*</span>}
                        {sort?.id === f.id && (sort.asc ? " ↑" : " ↓")}
                      </button>
                    </th>
                  ))}
                  <th className="end-cell" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id}>
                    <td className="index-cell">{i + 1}</td>
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
                {query || filter
                  ? "No matching entries."
                  : "Your table is ready. Add an entry or ask ChatGPT to fill it."}
              </div>
            )}
            <button
              className="add-row"
              disabled={expired}
              onClick={() =>
                change({ action: "add", tableId: t.id, rows: [{}] }).catch(
                  () => {},
                )
              }
            >
              <Plus size={15} />
              Add entry
            </button>
          </div>
          <div className="table-footer">
            <span>
              {t.rows.length} entries · {t.fields.length} columns
            </span>
            <span>Click any value to edit · Changes save automatically</span>
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
              setStructure(false);
              setSelected(null);
            })
          }
        />
      )}
      {detail && t && (
        <div className="overlay">
          <section className="modal detail">
            <div className="modal-heading">
              <div>
                <div className="eyebrow">ENTRY DETAILS</div>
                <h2>
                  {String(
                    t.rows.find((r) => r.id === detail)?.values[
                      t.fields[0].id
                    ] || "Untitled entry",
                  )}
                </h2>
              </div>
              <button onClick={() => setDetail(null)}>
                <X />
              </button>
            </div>
            {t.fields.map((f) => (
              <label key={f.id} className="detail-field">
                <span>
                  {f.name}
                  {f.required ? " *" : ""}
                </span>
                <small>{f.description}</small>
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
              </label>
            ))}
            <button
              className="danger text-button"
              onClick={() => {
                if (confirm("Delete this entry? You can undo this change."))
                  change({ action: "deleteRow", tableId: t.id, rowId: detail })
                    .then(() => setDetail(null))
                    .catch(() => {});
              }}
            >
              <Trash2 size={15} />
              Delete entry
            </button>
          </section>
        </div>
      )}
      {account && (
        <Account
          saved={!!w && !w.expiresAt}
          onClose={() => setAccount(false)}
          onDone={() => {
            setAccount(false);
            refresh();
          }}
        />
      )}
      <footer className="app-footer">
        <span>AtableZ</span>
        <span>Make room for what you know.</span>
      </footer>
    </>
  );
}
function Editable({
  value,
  label,
  onSave,
  className = "",
  placeholder = "",
}: {
  value: string;
  label: string;
  onSave: (v: string) => Promise<any>;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [err, setErr] = useState("");
  useEffect(() => setDraft(value), [value]);
  return (
    <div className={className}>
      <input
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
          }
        }}
        onBlur={() => {
          if (draft !== value)
            onSave(draft)
              .then(() => setErr(""))
              .catch((e) => {
                setErr(e.message);
                setDraft(value);
              });
        }}
      />
      {err && <small className="field-error">{err}</small>}
    </div>
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
  const [draft, setDraft] = useState(value ?? "");
  const [err, setErr] = useState("");
  useEffect(() => setDraft(value ?? ""), [value]);
  async function commit(next: any) {
    try {
      await onSave(next);
      setErr("");
    } catch (e: any) {
      setErr(e.message);
      setDraft(value ?? "");
    }
  }
  const label = f.name;
  return (
    <div className={"cell " + (f.fixed ? "fixed" : "")}>
      {f.type === "boolean" ? (
        <select
          aria-label={label}
          disabled={f.fixed}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) =>
            commit(e.target.value === "" ? null : e.target.value === "true")
          }
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : f.type === "select" ? (
        <select
          aria-label={label}
          disabled={f.fixed}
          value={value ?? ""}
          onChange={(e) => commit(e.target.value || null)}
          className={value ? "pill-select" : ""}
        >
          <option value="">Select…</option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          aria-label={label}
          readOnly={f.fixed}
          value={draft}
          type={f.type === "date" ? "date" : "text"}
          inputMode={
            ["integer", "number"].includes(f.type) ? "decimal" : undefined
          }
          placeholder="—"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              setDraft(value ?? "");
            }
          }}
          onBlur={() => {
            let v: any = draft;
            if (v === "") v = null;
            else if (["integer", "number"].includes(f.type)) {
              v = Number(v);
              if (
                !Number.isFinite(v) ||
                (f.type === "integer" && !Number.isSafeInteger(v))
              ) {
                setErr("Enter a valid " + f.type);
                setDraft(value ?? "");
                return;
              }
            }
            if (v !== value && !(v === null && value === undefined)) commit(v);
          }}
        />
      )}
      {err && <small className="field-error">{err}</small>}
    </div>
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
  const [fields, setFields] = useState(structuredClone(table.fields));
  const [instructions, setInstructions] = useState(table.instructions);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("columns");
  const changed =
    JSON.stringify(fields) !== JSON.stringify(table.fields) ||
    instructions !== table.instructions;
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
  function close() {
    if (!changed || confirm("Discard unsaved structure changes?")) onClose();
  }
  async function save() {
    if (
      destructive &&
      table.rows.length &&
      !confirm(
        `This change affects ${table.rows.length} entries.${removed.length ? " Removed columns: " + removed.map((f) => f.name).join(", ") + "." : ""} Review this before continuing. You can undo the change.`,
      )
    )
      return;
    setSaving(true);
    try {
      await onSave({
        action: "structure",
        fields,
        instructions,
        confirmRemoval: destructive,
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
            <div className="eyebrow">MAKE IT YOURS</div>
            <h2>Modify table</h2>
            <p>Set the structure once. Keep using it.</p>
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
                Give each column a clear name and describe what belongs there.
              </p>
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
                          ].map((x) => (
                            <option key={x} value={x}>
                              {
                                (
                                  {
                                    string: "String · short text",
                                    text: "Text · long text",
                                    integer: "Integer · whole number",
                                    number: "Number · decimal",
                                    date: "Date",
                                    boolean: "Boolean · yes/no",
                                    select: "Select · choices",
                                    url: "URL · link",
                                  } as any
                                )[x]
                              }
                            </option>
                          ))}
                        </select>
                      </label>
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
                    {f.type === "select" && (
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
                          value={f.fixedValue ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            edit(f.id, {
                              fixedValue:
                                v === ""
                                  ? null
                                  : ["integer", "number"].includes(f.type)
                                    ? Number(v)
                                    : f.type === "boolean"
                                      ? v === "true"
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
            onClick={() => {
              if (
                confirm(
                  "Delete this table and all its entries? You can undo it from another table.",
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
function Account({
  saved,
  onClose,
  onDone,
}: {
  saved: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="overlay">
      <section className="modal account">
        <div className="modal-heading">
          <div>
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h2>
              {saved
                ? "Your tables are saved"
                : mode === "signup"
                  ? "Keep what you’ve created."
                  : "Welcome back."}
            </h2>
          </div>
          <button onClick={onClose}>
            <X />
          </button>
        </div>
        {saved ? (
          <>
            <p>
              Your tables are stored in your account. Connect AtableZ in ChatGPT
              to retrieve them in another conversation.
            </p>
            <button
              className="outline"
              onClick={async () => {
                await api("auth/logout", {});
                setAuth("");
                location.reload();
              }}
            >
              <LogOut size={15} />
              Sign out
            </button>
          </>
        ) : (
          <>
            <p>
              {mode === "signup"
                ? "Create a free account to keep your tables after the one-hour preview. Everything you have created will stay with you."
                : "Log in to access your tables. Your current preview will be added to your account."}
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setErr("");
                try {
                  const x = await api(`auth/${mode}`, { email, password });
                  setAuth(x.auth);
                  onDone();
                } catch (e: any) {
                  setErr(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="form-label">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="form-label">
                Password
                <input
                  type="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  minLength={mode === "signup" ? 12 : 1}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {mode === "signup" && (
                <small className="help">
                  Use at least 12 characters. Account recovery is not yet
                  available in this private beta.
                </small>
              )}
              {err && (
                <div role="alert" className="error">
                  {err}
                </div>
              )}
              <button className="primary full" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "signup"
                    ? "Create account & keep my tables"
                    : "Log in"}
              </button>
            </form>
            <button
              className="text-button"
              onClick={() => setMode(mode === "signup" ? "login" : "signup")}
            >
              {mode === "signup"
                ? "Already have an account? Log in"
                : "New to AtableZ? Create an account"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
