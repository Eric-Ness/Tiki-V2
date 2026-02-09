import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectsStore } from "../../stores";
import { MarkdownRenderer } from "./MarkdownRenderer";
import "./IssueComments.css";

interface CommentAuthor {
  login: string;
}

interface GitHubComment {
  id: string;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  url: string;
}

interface IssueCommentsProps {
  issueNumber: number;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function IssueComments({ issueNumber }: IssueCommentsProps) {
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeProject = useProjectsStore((s) => s.getActiveProject());

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<GitHubComment[]>("fetch_issue_comments", {
        number: issueNumber,
        projectPath: activeProject?.path,
      });
      setComments(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [issueNumber, activeProject?.path]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handlePost = async () => {
    if (!newComment.trim()) return;
    try {
      setPosting(true);
      setPostError(null);
      await invoke("post_issue_comment", {
        number: issueNumber,
        body: newComment,
        projectPath: activeProject?.path,
      });
      setNewComment("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      await fetchComments();
    } catch (err) {
      setPostError(String(err));
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePost();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewComment(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  return (
    <div className="detail-section">
      <h3 className="detail-section-title">
        Comments {!loading && comments.length > 0 && `(${comments.length})`}
      </h3>

      {loading ? (
        <div className="comments-status">Loading comments...</div>
      ) : error ? (
        <div className="comments-error">{error}</div>
      ) : comments.length === 0 ? (
        <div className="comments-status">No comments yet</div>
      ) : (
        <div className="comments-list">
          {comments.map((comment) => (
            <div key={comment.id} className="comment-item">
              <div className="comment-header">
                <span className="comment-author">{comment.author.login}</span>
                <span className="comment-timestamp">
                  {formatTimestamp(comment.createdAt)}
                </span>
              </div>
              <div className="comment-body markdown-body">
                <MarkdownRenderer>{comment.body}</MarkdownRenderer>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="comment-form">
        <textarea
          ref={textareaRef}
          className="comment-textarea"
          placeholder="Write a comment... (Ctrl+Enter to submit)"
          value={newComment}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          disabled={posting}
          rows={3}
        />
        {postError && <div className="comment-form-error">{postError}</div>}
        <div className="comment-form-actions">
          <button
            className="comment-submit-btn"
            onClick={handlePost}
            disabled={posting || !newComment.trim()}
          >
            {posting ? "Posting..." : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
