import { useState, useEffect, useRef, useMemo } from 'react';
import { Eye, FileCode, Loader2, MessageSquare, Send, Bot, User } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import type { WorktreeDiff, WorktreeFileDiff } from '../../../../shared/types';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface DiffViewDialogProps {
  open: boolean;
  worktreeDiff: WorktreeDiff | null;
  taskId: string | null;
  specId: string | null;
  projectId: string | null;
  onOpenChange: (open: boolean) => void;
}

// Safe link component for markdown
const createSafeLink = () => {
  return function SafeLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    const isValidUrl = href && (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('/') ||
      href.startsWith('#')
    );

    if (!isValidUrl) {
      return <span className="text-muted-foreground">{children}</span>;
    }

    const isExternal = href?.startsWith('http://') || href?.startsWith('https://');

    return (
      <a
        href={href}
        {...props}
        {...(isExternal && {
          target: '_blank',
          rel: 'noopener noreferrer',
        })}
        className="text-primary hover:underline"
      >
        {children}
      </a>
    );
  };
};

/**
 * Dialog displaying changed files with 3-panel layout:
 * - Left: File list
 * - Center: Diff content
 * - Right: AI Chat
 */
export function DiffViewDialog({
  open,
  worktreeDiff,
  taskId,
  specId,
  projectId,
  onOpenChange
}: DiffViewDialogProps) {
  // File selection state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiffContent, setFileDiffContent] = useState<WorktreeFileDiff | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [streamingResponse, setStreamingResponse] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionId = `diff-view-${taskId}`;
  const markdownComponents: Components = useMemo(() => ({
    a: createSafeLink(),
    // Custom code component that wraps long lines
    code: ({ className, children, ...props }) => {
      // Check if this is inline code or code block
      const isInline = !className?.includes('language-');
      return (
        <code
          className={cn(
            'rounded bg-muted px-1 py-0.5 text-[10px]',
            !isInline && 'block overflow-x-auto whitespace-pre-wrap break-all',
            isInline && 'whitespace-pre-wrap break-all'
          )}
          {...props}
        >
          {children}
        </code>
      );
    },
    // Custom pre component for code blocks
    pre: ({ children, ...props }) => (
      <pre
        className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] bg-muted p-2 rounded-md my-2"
        {...props}
      >
        {children}
      </pre>
    ),
    // Ensure paragraphs wrap properly
    p: ({ children, ...props }) => (
      <p className="whitespace-pre-wrap break-words my-1" {...props}>
        {children}
      </p>
    ),
  }), [cn]);

  // Auto-select first file when diff loads
  useEffect(() => {
    if (open && worktreeDiff?.files && worktreeDiff.files.length > 0 && !selectedFile) {
      setSelectedFile(worktreeDiff.files[0].path);
    }
  }, [open, worktreeDiff, selectedFile]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setFileDiffContent(null);
      setDiffError(null);
      setChatMessages([]);
      setStreamingResponse('');
    }
  }, [open]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, streamingResponse]);

  // Set up streaming listener
  useEffect(() => {
    if (!specId || !projectId) return;

    const cleanupStreamChunk = window.electronAPI.onReviewQAStreamChunk(
      (incomingSessionId, incomingProjectId, chunk) => {
        if (incomingSessionId !== sessionId || incomingProjectId !== projectId) {
          return;
        }

        if (chunk.type === 'text' && chunk.content) {
          setStreamingResponse((prev) => prev + chunk.content);
        } else if (chunk.type === 'error') {
          setDiffError(chunk.error || 'Failed to get response');
          setIsChatLoading(false);
        } else if (chunk.type === 'done') {
          if (streamingResponse) {
            setChatMessages((prev) => [...prev, { role: 'assistant', content: streamingResponse }]);
          }
          setStreamingResponse('');
          setIsChatLoading(false);
        }
      }
    );

    const cleanupError = window.electronAPI.onReviewQAError(
      (incomingSessionId, incomingProjectId, errorMessage) => {
        if (incomingSessionId !== sessionId || incomingProjectId !== projectId) {
          return;
        }
        setDiffError(errorMessage);
        setIsChatLoading(false);
        setStreamingResponse('');
      }
    );

    return () => {
      cleanupStreamChunk();
      cleanupError();
    };
  }, [sessionId, specId, projectId, streamingResponse]);

  // Load file diff when selection changes
  useEffect(() => {
    if (selectedFile && taskId && open) {
      loadFileDiff(selectedFile);
    } else {
      setFileDiffContent(null);
      setDiffError(null);
    }
  }, [selectedFile, taskId, open]);

  const loadFileDiff = async (filePath: string) => {
    if (!taskId) return;

    setIsLoadingDiff(true);
    setDiffError(null);

    try {
      const result = await window.electronAPI.getWorktreeFileDiff(taskId, filePath);
      if (result.success && result.data) {
        setFileDiffContent(result.data);
      } else {
        setDiffError(result.error || 'Failed to load file diff');
      }
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to load file diff');
    } finally {
      setIsLoadingDiff(false);
    }
  };

  const handleSendChat = () => {
    const question = chatInput.trim();
    if (!question || isChatLoading || !specId || !projectId) return;

    setChatMessages((prev) => [...prev, { role: 'user', content: question }]);
    setChatInput('');
    setIsChatLoading(true);

    const diffContext = buildDiffContext();
    const contextualQuestion = `Regarding this file change (${selectedFile}):\n\n${diffContext}\n\nQuestion: ${question}`;

    window.electronAPI.sendReviewQAMessage(sessionId, specId, projectId, contextualQuestion);
  };

  const buildDiffContext = () => {
    if (!fileDiffContent || fileDiffContent.hunks.length === 0) {
      return 'No diff content available';
    }

    const hunksSummary = fileDiffContent.hunks.map(hunk => {
      const addedLines = hunk.lines.filter(l => l.type === 'added').length;
      const removedLines = hunk.lines.filter(l => l.type === 'removed').length;
      return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ (+${addedLines}, -${removedLines} lines)`;
    }).join('\n');

    return `Status: ${fileDiffContent.status}\nHunks:\n${hunksSummary}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  const getStatusColor = (status: WorktreeFileDiff['status']) => {
    switch (status) {
      case 'added': return 'text-success';
      case 'deleted': return 'text-destructive';
      case 'modified': return 'text-info';
      case 'renamed': return 'text-warning';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px] max-h-[90vh] overflow-hidden flex flex-col p-0">
        {/* Header */}
        <div className="px-6 py-4 border-b">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-purple-400" />
              Changed Files
            </DialogTitle>
            <DialogDescription>
              {worktreeDiff?.summary || 'No changes found'}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* 3-Panel Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - File List */}
          <div className="w-72 border-r overflow-auto flex-shrink-0">
            <div className="p-3 border-b bg-muted/30">
              <h3 className="text-sm font-semibold">Files</h3>
              <p className="text-xs text-muted-foreground">
                {worktreeDiff?.files.length || 0} file{worktreeDiff?.files.length !== 1 ? 's' : ''} changed
              </p>
            </div>
            <div className="p-2 space-y-1">
              {worktreeDiff?.files && worktreeDiff.files.length > 0 ? (
                worktreeDiff.files.map((file, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedFile(file.path)}
                    className={cn(
                      'flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors group',
                      selectedFile === file.path
                        ? 'bg-primary/20 border border-primary/30'
                        : 'bg-secondary/30 hover:bg-secondary/50 border border-transparent'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileCode className={cn(
                        'h-4 w-4 shrink-0',
                        file.status === 'added' && 'text-success',
                        file.status === 'deleted' && 'text-destructive',
                        file.status === 'modified' && 'text-info',
                        file.status === 'renamed' && 'text-warning'
                      )} />
                      <span className="text-xs font-mono truncate">{file.path}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-success">+{file.additions}</span>
                      <span className="text-xs text-destructive">-{file.deletions}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No changed files
                </div>
              )}
            </div>
          </div>

          {/* Center Panel - Diff Content */}
          <div className="flex-1 overflow-auto">
            {selectedFile ? (
              <div className="h-full flex flex-col">
                {/* Diff header */}
                <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-mono truncate">{selectedFile}</span>
                  </div>
                  {fileDiffContent && (
                    <span className={cn(
                      'text-xs capitalize',
                      getStatusColor(fileDiffContent.status)
                    )}>
                      {fileDiffContent.status}
                    </span>
                  )}
                </div>

                {/* Diff content */}
                <div className="flex-1 overflow-auto p-4">
                  {isLoadingDiff ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-sm text-muted-foreground">Loading diff...</span>
                    </div>
                  ) : diffError ? (
                    <div className="flex items-center justify-center py-12 text-destructive text-sm">
                      {diffError}
                    </div>
                  ) : fileDiffContent && fileDiffContent.hunks.length > 0 ? (
                    <div className="space-y-3 font-mono text-xs">
                      {fileDiffContent.hunks.map((hunk, hunkIdx) => (
                        <div
                          key={hunkIdx}
                          className="rounded-lg border overflow-hidden"
                        >
                          {/* Hunk header */}
                          <div className="bg-muted px-3 py-1.5 text-xs border-b">
                            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                          </div>

                          {/* Diff lines */}
                          <div className="bg-background">
                            {hunk.lines.map((line, lineIdx) => (
                              <div
                                key={lineIdx}
                                className={cn(
                                  'px-3 py-0.5 whitespace-pre-wrap break-all border-l-2',
                                  line.type === 'added' && 'bg-success/10 border-l-success',
                                  line.type === 'removed' && 'bg-destructive/10 border-l-destructive',
                                  line.type === 'context' && 'border-l-transparent'
                                )}
                              >
                                <span className={cn(
                                  'inline-block w-4 mr-2 select-none',
                                  line.type === 'added' && 'text-success',
                                  line.type === 'removed' && 'text-destructive',
                                  line.type === 'context' && 'text-muted-foreground'
                                )}>
                                  {line.type === 'added' && '+'}
                                  {line.type === 'removed' && '-'}
                                  {line.type === 'context' && ' '}
                                </span>
                                <span className={cn(
                                  line.type === 'added' && 'text-success/90',
                                  line.type === 'removed' && 'text-destructive/90',
                                  line.type === 'context' && 'text-muted-foreground'
                                )}>
                                  {line.content || ' '}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : fileDiffContent && fileDiffContent.hunks.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No diff content available
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <FileCode className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Select a file to view changes</p>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - AI Chat */}
          <div className="w-96 border-l flex flex-col shrink-0 bg-muted/20">
            {/* Chat header */}
            <div className="px-3 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-xs font-semibold">AI Assistant</h3>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Ask questions about the code changes
              </p>
            </div>

            {/* Chat messages */}
            <div className="flex-1 overflow-auto px-2.5 py-2 space-y-2">
              {chatMessages.length === 0 && !streamingResponse && !isChatLoading ? (
                <div className="flex h-full flex-col items-center justify-center text-center py-4">
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h3 className="mb-1 text-xs font-medium text-foreground">
                    Ask about this change
                  </h3>
                  <p className="max-w-[200px] text-[10px] text-muted-foreground mb-3">
                    Get AI explanations about the code changes in this file
                  </p>

                  {/* Suggested questions */}
                  <div className="space-y-1.5 w-full">
                    <p className="text-[10px] text-muted-foreground text-left">Try asking:</p>
                    {[
                      'What does this file do?',
                      'Explain the changes made',
                      'Are there any potential bugs?',
                      'How does this affect the codebase?'
                    ].map((question, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setChatInput(question);
                        }}
                        className="w-full text-left px-2 py-1.5 text-[10px] bg-background border border-border rounded-md hover:bg-muted/50 hover:border-primary/30 transition-colors leading-tight"
                        disabled={isChatLoading || !selectedFile}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {chatMessages.map((message, idx) => (
                    <div key={idx} className="flex gap-1.5 min-w-0">
                      <div className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                        message.role === 'user' ? 'bg-muted' : 'bg-primary/10'
                      )}>
                        {message.role === 'user' ? (
                          <User className="h-2.5 w-2.5 text-muted-foreground" />
                        ) : (
                          <Bot className="h-2.5 w-2.5 text-primary" />
                        )}
                      </div>
                      <div className={cn(
                        'min-w-0 flex-1 rounded-md px-2 py-1.5 text-[11px] leading-relaxed',
                        message.role === 'user' ? 'bg-muted' : 'bg-background border'
                      )}>
                        {message.role === 'user' ? (
                          <div className="whitespace-pre-wrap wrap-break-word">{message.content}</div>
                        ) : (
                          <div className="[&]:text-[11px] [&]:leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Streaming message */}
                  {streamingResponse && (
                    <div className="flex gap-1.5 min-w-0">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-2.5 w-2.5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1 rounded-md bg-background border px-2 py-1.5 text-[11px] leading-relaxed">
                        <div className="[&]:text-[11px] [&]:leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {streamingResponse}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Loading indicator */}
                  {isChatLoading && !streamingResponse && (
                    <div className="flex gap-1.5">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Bot className="h-2.5 w-2.5 text-primary" />
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        Thinking...
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            {/* Chat input */}
            <div className="border-t px-2.5 py-2 bg-background">
              <div className="flex gap-1.5">
                <Textarea
                  ref={textareaRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about this change..."
                  className="min-h-14 resize-none text-[11px] max-h-24 py-1.5"
                  disabled={isChatLoading || !selectedFile}
                />
                <Button
                  onClick={handleSendChat}
                  disabled={!chatInput.trim() || isChatLoading || !selectedFile}
                  size="icon"
                  className="self-end h-8 w-8"
                >
                  {isChatLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
