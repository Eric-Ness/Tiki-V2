import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MarkdownRenderer } from "./MarkdownRenderer";
import "./ResearchDetail.css";

interface ResearchDetailProps {
  filename: string;
  projectPath: string | undefined;
}

interface FrontMatter {
  topic: string;
  tags: string[];
  issues: number[];
  created: string;
}

interface ParsedDoc {
  frontMatter: FrontMatter;
  body: string;
}

/** Parse a YAML-ish front-matter scalar that may be a JSON-style array or comma-separated. */
function parseListValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "[]") return [];

  // JSON-style array: [a, b, c] or ["a", "b"]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return inner
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s.length > 0);
  }

  // Comma-separated fallback
  return trimmed
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

function parseScalar(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

function parseFrontMatter(raw: string): ParsedDoc {
  // Locate opening --- and closing ---
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return {
      frontMatter: { topic: "", tags: [], issues: [], created: "" },
      body: raw,
    };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return {
      frontMatter: { topic: "", tags: [], issues: [], created: "" },
      body: raw,
    };
  }

  const fmLines = lines.slice(1, endIndex);
  const bodyLines = lines.slice(endIndex + 1);

  const fm: FrontMatter = { topic: "", tags: [], issues: [], created: "" };

  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1);

    switch (key) {
      case "topic":
        fm.topic = parseScalar(value);
        break;
      case "tags":
        fm.tags = parseListValue(value);
        break;
      case "issues":
        fm.issues = parseListValue(value)
          .map((s) => Number(s))
          .filter((n) => !isNaN(n));
        break;
      case "created":
        fm.created = parseScalar(value);
        break;
    }
  }

  // Body: drop leading blank lines for cleaner rendering
  let bodyStart = 0;
  while (bodyStart < bodyLines.length && bodyLines[bodyStart].trim() === "") {
    bodyStart++;
  }
  const body = bodyLines.slice(bodyStart).join("\n");

  return { frontMatter: fm, body };
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.length >= 10 ? iso.slice(0, 10) : iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ResearchDetail({ filename, projectPath }: ResearchDetailProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setContent(null);

    const tikiPath = projectPath ? `${projectPath}/.tiki` : undefined;

    invoke<string>("read_research_doc", { filename, tikiPath })
      .then((raw) => {
        if (cancelled) return;
        setContent(raw);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filename, projectPath]);

  if (isLoading) {
    return (
      <div className="research-detail-loading">
        <span className="research-detail-spinner" />
        Loading research...
      </div>
    );
  }

  if (error) {
    return <div className="research-detail-error">{error}</div>;
  }

  if (content === null) {
    return null;
  }

  const { frontMatter, body } = parseFrontMatter(content);
  const displayTopic = frontMatter.topic || filename;

  return (
    <div className="detail-view">
      <div className="research-detail-header">
        <h2 className="research-detail-topic">{displayTopic}</h2>
        {frontMatter.tags.length > 0 && (
          <div className="research-detail-tags">
            {frontMatter.tags.map((tag) => (
              <span key={tag} className="research-detail-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="research-detail-meta">
          {frontMatter.created && (
            <span className="research-detail-date">{formatDate(frontMatter.created)}</span>
          )}
          {frontMatter.issues.length > 0 && (
            <div className="research-detail-issues">
              {frontMatter.issues.map((n) => (
                <span key={n} className="research-detail-issue">#{n}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="research-detail-body markdown-body">
        <MarkdownRenderer>{body}</MarkdownRenderer>
      </div>
    </div>
  );
}
