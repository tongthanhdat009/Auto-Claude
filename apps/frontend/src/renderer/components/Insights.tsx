import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Send,
  Loader2,
  Plus,
  Sparkles,
  User,
  Bot,
  CheckCircle2,
  AlertCircle,
  Search,
  FileText,
  FolderSearch,
  PanelLeftClose,
  PanelLeft,
  X,
  Zap
} from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import {
  useInsightsStore,
  loadInsightsSession,
  sendMessage,
  newSession,
  switchSession,
  deleteSession,
  renameSession,
  updateModelConfig,
  createTaskFromSuggestion,
  setupInsightsListeners,
  resetStatus,
  abortGeneration,
  type InsightsSessionState
} from '../stores/insights-store';
import { useTaskStore } from '../stores/task-store';
import { ChatHistorySidebar } from './ChatHistorySidebar';
import { InsightsModelSelector } from './InsightsModelSelector';
import { InsightsProfileSelector } from './InsightsProfileSelector';
import { RoadmapFeatureCard } from './RoadmapFeatureCard';
import { IdeationItemCard } from './IdeationItemCard';
import type { InsightsChatMessage, InsightsModelConfig, InsightsSessionSummary, RoadmapFeature, Idea } from '../../shared/types';
import {
  TASK_CATEGORY_LABELS,
  TASK_CATEGORY_COLORS,
  TASK_COMPLEXITY_LABELS,
  TASK_COMPLEXITY_COLORS
} from '../../shared/constants';

// createSafeLink - factory function that creates a SafeLink component with i18n support
const createSafeLink = (opensInNewWindowText: string) => {
  return function SafeLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    // Validate URL - only allow http, https, and relative links
    const isValidUrl = href && (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('/') ||
      href.startsWith('#')
    );

    if (!isValidUrl) {
      // For invalid or potentially malicious URLs, render as plain text
      return <span className="text-muted-foreground">{children}</span>;
    }

    // External links get security attributes and accessibility indicator
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
        {isExternal && <span className="sr-only"> {opensInNewWindowText}</span>}
      </a>
    );
  };
};

interface InsightsProps {
  projectId: string;
}

export function Insights({ projectId }: InsightsProps) {
  const { t } = useTranslation(['common', 'insights']);
  const session = useInsightsStore((state) => state.session);
  const currentSessionId = useInsightsStore((state) => state.currentSessionId);
  const sessions = useInsightsStore((state) => state.sessions);
  const status = useInsightsStore((state) => state.status);
  const streamingContent = useInsightsStore((state) => state.streamingContent);
  const currentTool = useInsightsStore((state) => state.currentTool);
  const isLoadingSessions = useInsightsStore((state) => state.isLoadingSessions);
  const addTask = useTaskStore((state) => state.addTask);
  const selectTask = useTaskStore((state) => state.selectTask);
  const abortControllers = useInsightsStore((state) => state.abortControllers);
  const sessionStates = useInsightsStore((state) => state.sessionStates);
  const setApiProfileId = useInsightsStore((state) => state.setApiProfileId);

  // Get the current session's API profile ID (undefined = use default/active profile)
  const currentApiProfileId = useInsightsStore((state) => state.getCurrentSessionState()?.apiProfileId);

  // Create markdown components with translated accessibility text
  const markdownComponents = useMemo(() => ({
    a: createSafeLink(t('accessibility.opensInNewWindow')),
  }), [t]);

  const [inputValue, setInputValue] = useState('');
  const [creatingTask, setCreatingTask] = useState<string | null>(null);
  const [taskCreated, setTaskCreated] = useState<Set<string>>(new Set());
  const [taskCreationErrors, setTaskCreationErrors] = useState<Map<string, string>>(new Map());
  const [showSidebar, setShowSidebar] = useState(true);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  const [convertingToSpec, setConvertingToSpec] = useState(false);
  const [specCreated, setSpecCreated] = useState(false);
  const [specConversionError, setSpecConversionError] = useState<string | null>(null);
  const [convertingIdeationToSpec, setConvertingIdeationToSpec] = useState(false);
  const [ideationSpecCreated, setIdeationSpecCreated] = useState(false);
  const [ideationConversionError, setIdeationConversionError] = useState<string | null>(null);
  const [roadmapFeatures, setRoadmapFeatures] = useState<Map<string, RoadmapFeature>>(new Map());
  const [loadingFeatures, setLoadingFeatures] = useState<Set<string>>(new Set());
  const [ideationItems, setIdeationItems] = useState<Map<string, Idea>>(new Map());
  const [loadingIdeationItems, setLoadingIdeationItems] = useState<Set<string>>(new Set());

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Scroll threshold in pixels - user is considered "at bottom" if within this distance
  const SCROLL_BOTTOM_THRESHOLD = 100;

  // Check if user is near the bottom of scroll area
  const checkIfAtBottom = useCallback((viewport: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  // Handle scroll events to track user position
  const handleScroll = useCallback(() => {
    if (viewportEl) {
      setIsUserAtBottom(checkIfAtBottom(viewportEl));
    }
  }, [viewportEl, checkIfAtBottom]);

  // Set up scroll listener and check initial position when viewport becomes available
  useEffect(() => {
    if (viewportEl) {
      // Check initial scroll position
      setIsUserAtBottom(checkIfAtBottom(viewportEl));
      viewportEl.addEventListener('scroll', handleScroll, { passive: true });
      return () => viewportEl.removeEventListener('scroll', handleScroll);
    }
  }, [viewportEl, handleScroll, checkIfAtBottom]);

  // Load session and set up listeners on mount
  useEffect(() => { loadInsightsSession(projectId); resetStatus(); const cleanup = setupInsightsListeners(); return () => cleanup(); }, [projectId]);

  // Smart auto-scroll: only scroll if user is already at bottom
  // This allows users to scroll up to read previous messages without being
  // yanked back down during streaming responses
  useEffect(() => {
    if (isUserAtBottom && viewportEl) {
      viewportEl.scrollTop = viewportEl.scrollHeight;
    }
  }, [isUserAtBottom, viewportEl]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Reset taskCreated, taskCreationErrors, and roadmapFeatures when switching sessions
  useEffect(() => {
    setTaskCreated(new Set());
    setTaskCreationErrors(new Map());
    setSpecCreated(false);
    setSpecConversionError(null);
    setIdeationSpecCreated(false);
    setIdeationConversionError(null);
    setRoadmapFeatures(new Map());
    setLoadingFeatures(new Set());
    setIdeationItems(new Map());
    setLoadingIdeationItems(new Set());
  }, [session?.id]);

  // Fetch full roadmap features when session's roadmap features change
  const sessionRoadmapFeatures = useInsightsStore((state) => state.getRoadmapFeatures(session?.id || ''));

  useEffect(() => {
    if (!session?.id || !sessionRoadmapFeatures || sessionRoadmapFeatures.length === 0) {
      return;
    }

    const fetchRoadmapFeatures = async () => {
      for (const featureRef of sessionRoadmapFeatures) {
        // Skip if we already have this feature loaded
        if (roadmapFeatures.has(featureRef.id)) {
          continue;
        }

        // Skip if already loading
        if (loadingFeatures.has(featureRef.id)) {
          continue;
        }

        // Mark as loading
        setLoadingFeatures((prev) => new Set(prev).add(featureRef.id));

        try {
          const result = await window.electronAPI.getRoadmapFeatureDetails(projectId, featureRef.id);
          if (result.success && result.data) {
            const featureData = result.data;
            setRoadmapFeatures((prev) => new Map(prev).set(featureRef.id, featureData));
          }
        } catch (error) {
          console.error(`Failed to load roadmap feature ${featureRef.id}:`, error);
        } finally {
          setLoadingFeatures((prev) => {
            const next = new Set(prev);
            next.delete(featureRef.id);
            return next;
          });
        }
      }
    };

    fetchRoadmapFeatures();
  }, [session?.id, sessionRoadmapFeatures, projectId, loadingFeatures, roadmapFeatures]);

  // Fetch ideation items when session's ideation items change
  const sessionIdeationItems = useInsightsStore((state) => state.getIdeationItems(session?.id || ''));

  useEffect(() => {
    if (!session?.id || !sessionIdeationItems || sessionIdeationItems.length === 0) {
      return;
    }

    const fetchIdeationItems = async () => {
      // Get the full ideation session to access all ideas
      try {
        const result = await window.electronAPI.getIdeation(projectId);
        if (result.success && result.data) {
          const ideationSession = result.data;

          for (const itemRef of sessionIdeationItems) {
            // Skip if we already have this item loaded
            if (ideationItems.has(itemRef.id)) {
              continue;
            }

            // Skip if already loading
            if (loadingIdeationItems.has(itemRef.id)) {
              continue;
            }

            // Mark as loading
            setLoadingIdeationItems((prev) => new Set(prev).add(itemRef.id));

            try {
              // Find the idea in the ideation session
              const idea = ideationSession.ideas.find((i) => i.id === itemRef.id);
              if (idea) {
                setIdeationItems((prev) => new Map(prev).set(itemRef.id, idea));
              }
            } catch (error) {
              console.error(`Failed to load ideation item ${itemRef.id}:`, error);
            } finally {
              setLoadingIdeationItems((prev) => {
                const next = new Set(prev);
                next.delete(itemRef.id);
                return next;
              });
            }
          }
        }
      } catch (error) {
        console.error('Failed to load ideation session:', error);
      }
    };

    fetchIdeationItems();
  }, [session?.id, sessionIdeationItems, projectId, loadingIdeationItems, ideationItems]);

  const handleSend = async () => {
    const message = inputValue.trim();
    if (!message || status.phase === 'thinking' || status.phase === 'streaming') return;

    setInputValue('');
    setIsUserAtBottom(true); // Resume auto-scroll when user sends a message

    // If there's no active session, create one first
    if (!session?.id) {
      await newSession(projectId);
    }

    sendMessage(projectId, message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewSession = async () => {
    await newSession(projectId);
    setTaskCreated(new Set());
    textareaRef.current?.focus();
  };

  const handleSelectSession = async (sessionId: string) => {
    if (sessionId !== currentSessionId) {
      await switchSession(projectId, sessionId);
    }
  };

  const handleDeleteSession = async (sessionId: string): Promise<boolean> => {
    return await deleteSession(projectId, sessionId);
  };

  const handleRenameSession = async (sessionId: string, newTitle: string): Promise<boolean> => {
    return await renameSession(projectId, sessionId, newTitle);
  };

  const handleCreateTask = async (message: InsightsChatMessage) => {
    if (!message.suggestedTask) return;

    // Clear any previous error for this message
    setTaskCreationErrors(prev => {
      const next = new Map(prev);
      next.delete(message.id);
      return next;
    });

    setCreatingTask(message.id);
    try {
      const task = await createTaskFromSuggestion(
        projectId,
        message.suggestedTask.title,
        message.suggestedTask.description,
        message.suggestedTask.metadata
      );

      if (task) {
        setTaskCreated(prev => new Set(prev).add(message.id));
        // Add the new task to the store to update kanban board state
        addTask(task);
      } else {
        // Task creation failed - set error state
        setTaskCreationErrors(prev => new Map(prev).set(message.id, t('errors.taskCreationFailed')));
      }
    } catch (error) {
      // Task creation threw an error - set error state
      setTaskCreationErrors(prev => new Map(prev).set(message.id, t('errors.taskCreationFailed')));
    } finally {
      setCreatingTask(null);
    }
  };

  const handleModelConfigChange = async (config: InsightsModelConfig) => {
    // If we have a session, persist the config
    if (session?.id) {
      await updateModelConfig(projectId, session.id, config);
    }
  };

  const handleApiProfileChange = (profileId: string | undefined) => {
    // Update the API profile ID for the current session
    // undefined means use default/active profile
    setApiProfileId(profileId);
  };

  const handleAbortSession = (sessionId: string) => {
    abortGeneration(sessionId);
  };

  const handleConvertToSpec = async () => {
    if (!session?.roadmapContext) return;

    setSpecConversionError(null);
    setConvertingToSpec(true);

    try {
      const result = await window.electronAPI.convertFeatureToSpec(
        projectId,
        session.roadmapContext.featureId
      );

      if (result.success && result.data) {
        setSpecCreated(true);
        // Add the new task to the store to update kanban board state
        addTask(result.data);
      } else {
        setSpecConversionError(t('errors.taskCreationFailed'));
      }
    } catch (error) {
      setSpecConversionError(t('errors.taskCreationFailed'));
    } finally {
      setConvertingToSpec(false);
    }
  };

  const handleConvertIdeationContextToSpec = async () => {
    if (!session?.ideationContext) return;

    setIdeationConversionError(null);
    setConvertingIdeationToSpec(true);

    try {
      const result = await window.electronAPI.convertIdeaToTask(
        projectId,
        session.ideationContext.ideaId
      );

      if (result.success && result.data) {
        setIdeationSpecCreated(true);
        // Add the new task to the store to update kanban board state
        addTask(result.data);
      } else {
        setIdeationConversionError(t('errors.taskCreationFailed'));
      }
    } catch (error) {
      setIdeationConversionError(t('errors.taskCreationFailed'));
    } finally {
      setConvertingIdeationToSpec(false);
    }
  };

  const handleConvertFeatureToSpec = async (feature: RoadmapFeature) => {
    try {
      const result = await window.electronAPI.convertFeatureToSpec(
        projectId,
        feature.id
      );

      if (result.success && result.data) {
        addTask(result.data);
      }
    } catch (error) {
      console.error('Failed to convert feature to spec:', error);
    }
  };

  const handleViewLinkedSpec = (specId: string) => {
    // Navigate to the spec view by selecting the task
    selectTask(specId);
  };

  const handleExploreFeatureInChat = async (feature: RoadmapFeature) => {
    // Create a new session and send initial message with feature context
    await newSession(projectId);

    // Build a comprehensive context message for the feature
    const contextMessage = `I'd like to explore the roadmap feature "${feature.title}".

**Description:** ${feature.description}

**Rationale:** ${feature.rationale}

**Priority:** ${feature.priority}
**Complexity:** ${feature.complexity}
**Impact:** ${feature.impact}

**User Stories:**
${feature.userStories.map((story, i) => `${i + 1}. ${story}`).join('\n')}

**Acceptance Criteria:**
${feature.acceptanceCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join('\n')}

${feature.dependencies?.length ? `**Dependencies:**\n${feature.dependencies.map((dep, i) => `${i + 1}. ${dep}`).join('\n')}\n` : ''}

Can you help me understand this feature better?`;

    // Send the context message to the new session
    sendMessage(projectId, contextMessage);
    setIsUserAtBottom(true); // Resume auto-scroll
  };

  const handleExploreIdeationItemInChat = async (idea: Idea) => {
    // Create a new session and send initial message with ideation item context
    await newSession(projectId);

    // Build a comprehensive context message for the ideation item
    const contextMessage = `I'd like to explore the ${idea.type} idea "${idea.title}".

**Description:** ${idea.description}

**Rationale:** ${idea.rationale}

Can you help me understand this idea better and how to implement it?`;

    // Send the context message to the new session
    sendMessage(projectId, contextMessage);
    setIsUserAtBottom(true); // Resume auto-scroll
  };

  const handleConvertIdeationToSpec = async (idea: Idea) => {
    try {
      const result = await window.electronAPI.convertIdeaToTask(
        projectId,
        idea.id
      );

      if (result.success && result.data) {
        addTask(result.data);
      }
    } catch (error) {
      console.error('Failed to convert ideation item to spec:', error);
    }
  };

  const isLoading = status.phase === 'thinking' || status.phase === 'streaming';
  const messages = session?.messages || [];

  return (
    <div className="flex h-full">
      {/* Chat History Sidebar */}
      {showSidebar && (
        <ChatHistorySidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          isLoading={isLoadingSessions}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
        />
      )}

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowSidebar(!showSidebar)}
              title={showSidebar ? t('insights:insights.hideSidebar') : t('insights:insights.showSidebar')}
            >
              {showSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{t('insights:insights.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {session?.roadmapContext
                  ? t('insights:insights.exploringRoadmapItem')
                  : session?.ideationContext
                  ? t('insights:insights.exploringIdeationItem')
                  : t('insights:insights.subtitle')
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session?.roadmapContext && (
              <Button
                size="sm"
                onClick={handleConvertToSpec}
                disabled={convertingToSpec || specCreated}
                variant={specConversionError ? "destructive" : "default"}
              >
                {convertingToSpec ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('insights:insights.convertingToSpec')}
                  </>
                ) : specCreated ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {t('insights:insights.specCreated')}
                  </>
                ) : specConversionError ? (
                  <>
                    {t('insights:insights.convertToSpec')}
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    {t('insights:insights.convertToSpec')}
                  </>
                )}
              </Button>
            )}
            {session?.ideationContext && (
              <Button
                size="sm"
                onClick={handleConvertIdeationContextToSpec}
                disabled={convertingIdeationToSpec || ideationSpecCreated}
                variant={ideationConversionError ? "destructive" : "default"}
              >
                {convertingIdeationToSpec ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('insights:insights.convertingToSpec')}
                  </>
                ) : ideationSpecCreated ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {t('insights:insights.specCreated')}
                  </>
                ) : ideationConversionError ? (
                  <>
                    {t('insights:insights.convertToSpec')}
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    {t('insights:insights.convertToSpec')}
                  </>
                )}
              </Button>
            )}
            <InsightsModelSelector
              currentConfig={session?.modelConfig}
              onConfigChange={handleModelConfigChange}
              disabled={isLoading}
            />
            <InsightsProfileSelector
              currentProfileId={currentApiProfileId}
              onProfileChange={handleApiProfileChange}
              disabled={isLoading}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewSession}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('insights:insights.newChat')}
            </Button>
          </div>
        </div>

        {/* Spec conversion error message */}
        {specConversionError && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{specConversionError}</span>
          </div>
        )}

        {/* Ideation conversion error message */}
        {ideationConversionError && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{ideationConversionError}</span>
          </div>
        )}

      {/* Messages */}
      <ScrollArea
        className="flex-1 px-6 py-4"
        onViewportRef={setViewportEl}
      >
        {/* Concurrent Sessions Indicator */}
        <ConcurrentSessions
          sessions={sessions}
          abortControllers={abortControllers}
          sessionStates={sessionStates}
          currentSessionId={currentSessionId}
          onAbortSession={handleAbortSession}
          onSelectSession={handleSelectSession}
        />
        {messages.length === 0 && !streamingContent ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">
              {t('insights:insights.startConversation')}
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {t('insights:insights.startConversationDescription')}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                t('insights:insights.suggestion1'),
                t('insights:insights.suggestion2'),
                t('insights:insights.suggestion3'),
                t('insights:insights.suggestion4')
              ].map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setInputValue(suggestion);
                    textareaRef.current?.focus();
                  }}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                markdownComponents={markdownComponents}
                onCreateTask={() => handleCreateTask(message)}
                isCreatingTask={creatingTask === message.id}
                taskCreated={taskCreated.has(message.id)}
                taskCreationError={taskCreationErrors.get(message.id)}
                roadmapFeatures={message.role === 'assistant' ? Array.from(roadmapFeatures.values()) : undefined}
                onConvertFeatureToSpec={handleConvertFeatureToSpec}
                onViewLinkedSpec={handleViewLinkedSpec}
                onExploreFeatureInChat={handleExploreFeatureInChat}
                ideationItems={message.role === 'assistant' ? Array.from(ideationItems.values()) : undefined}
                onConvertIdeationToSpec={handleConvertIdeationToSpec}
                onExploreIdeationItemInChat={handleExploreIdeationItemInChat}
              />
            ))}

            {/* Streaming message */}
            {(streamingContent || currentTool) && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 text-sm font-medium text-foreground">
                    {t('insights:insights.assistant')}
                  </div>
                  {streamingContent && (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                  )}
                  {/* Tool usage indicator */}
                  {currentTool && (
                    <ToolIndicator name={currentTool.name} input={currentTool.input} />
                  )}
                </div>
              </div>
            )}

            {/* Thinking indicator */}
            {status.phase === 'thinking' && !streamingContent && !currentTool && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('insights:insights.thinking')}
                </div>
              </div>
            )}

            {/* Error message */}
            {status.phase === 'error' && status.error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {status.error}
              </div>
            )}

          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border p-4">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('insights:insights.askAboutCodebase')}
            className="min-h-[80px] resize-none"
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className="self-end"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t('insights:insights.pressEnterToSend')}
        </p>
      </div>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: InsightsChatMessage;
  markdownComponents: Components;
  onCreateTask: () => void;
  isCreatingTask: boolean;
  taskCreated: boolean;
  taskCreationError?: string;
  roadmapFeatures?: RoadmapFeature[];
  onConvertFeatureToSpec?: (feature: RoadmapFeature) => void;
  onViewLinkedSpec?: (specId: string) => void;
  onExploreFeatureInChat?: (feature: RoadmapFeature) => void;
  ideationItems?: Idea[];
  onConvertIdeationToSpec?: (idea: Idea) => void;
  onExploreIdeationItemInChat?: (idea: Idea) => void;
}

function MessageBubble({
  message,
  markdownComponents,
  onCreateTask,
  isCreatingTask,
  taskCreated,
  taskCreationError,
  roadmapFeatures,
  onConvertFeatureToSpec,
  onViewLinkedSpec,
  onExploreFeatureInChat,
  ideationItems,
  onConvertIdeationToSpec,
  onExploreIdeationItemInChat
}: MessageBubbleProps) {
  const { t } = useTranslation(['common', 'insights']);
  const isUser = message.role === 'user';

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-muted' : 'bg-primary/10'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="flex-1 space-y-2">
        <div className="text-sm font-medium text-foreground">
          {isUser ? t('insights:insights.you') : t('insights:insights.assistant')}
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Tool usage history for assistant messages */}
        {!isUser && message.toolsUsed && message.toolsUsed.length > 0 && (
          <ToolUsageHistory tools={message.toolsUsed} />
        )}

        {/* Roadmap feature cards for assistant messages */}
        {!isUser && roadmapFeatures && roadmapFeatures.length > 0 && (
          <div className="space-y-3">
            {roadmapFeatures.map((feature) => (
              <RoadmapFeatureCard
                key={feature.id}
                feature={feature}
                onConvertToSpec={onConvertFeatureToSpec}
                onViewLinkedSpec={onViewLinkedSpec}
                onExploreInChat={onExploreFeatureInChat}
              />
            ))}
          </div>
        )}

        {/* Ideation item cards for assistant messages */}
        {!isUser && ideationItems && ideationItems.length > 0 && (
          <div className="space-y-3">
            {ideationItems.map((idea) => (
              <IdeationItemCard
                key={idea.id}
                idea={idea}
                onConvertToSpec={onConvertIdeationToSpec}
                onViewLinkedSpec={onViewLinkedSpec}
                onExploreInChat={onExploreIdeationItemInChat}
              />
            ))}
          </div>
        )}

        {/* Task suggestion card */}
        {message.suggestedTask && (
          <Card className="mt-3 border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-primary">
                  {t('insights:insights.suggestedTask')}
                </span>
              </div>
              <h4 className="mb-2 font-medium text-foreground">
                {message.suggestedTask.title}
              </h4>
              <p className="mb-3 text-sm text-muted-foreground">
                {message.suggestedTask.description}
              </p>
              {message.suggestedTask.metadata && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {message.suggestedTask.metadata.category && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs',
                        TASK_CATEGORY_COLORS[message.suggestedTask.metadata.category]
                      )}
                    >
                      {TASK_CATEGORY_LABELS[message.suggestedTask.metadata.category] ||
                        message.suggestedTask.metadata.category}
                    </Badge>
                  )}
                  {message.suggestedTask.metadata.complexity && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs',
                        TASK_COMPLEXITY_COLORS[message.suggestedTask.metadata.complexity]
                      )}
                    >
                      {TASK_COMPLEXITY_LABELS[message.suggestedTask.metadata.complexity] ||
                        message.suggestedTask.metadata.complexity}
                    </Badge>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {/* Error message */}
                {taskCreationError && !taskCreated && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{taskCreationError}</span>
                  </div>
                )}
                <Button
                  size="sm"
                  onClick={onCreateTask}
                  disabled={isCreatingTask || taskCreated}
                  variant={taskCreationError ? "destructive" : "default"}
                >
                  {isCreatingTask ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('insights:insights.creating')}
                    </>
                  ) : taskCreated ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {t('insights:insights.taskCreated')}
                    </>
                  ) : taskCreationError ? (
                    <>
                      {t('insights:insights.retry')}
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      {t('insights:insights.createTask')}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Tool usage history component for showing tools used in completed messages
interface ToolUsageHistoryProps {
  tools: Array<{
    name: string;
    input?: string;
    timestamp: Date;
  }>;
}

function ToolUsageHistory({ tools }: ToolUsageHistoryProps) {
  const { t } = useTranslation('insights');
  const [expanded, setExpanded] = useState(false);

  if (tools.length === 0) return null;

  // Group tools by name for summary
  const toolCounts = tools.reduce((acc, tool) => {
    acc[tool.name] = (acc[tool.name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return FileText;
      case 'Glob':
        return FolderSearch;
      case 'Grep':
        return Search;
      default:
        return FileText;
    }
  };

  const getToolColor = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return 'text-blue-500';
      case 'Glob':
        return 'text-amber-500';
      case 'Grep':
        return 'text-green-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1">
          {Object.entries(toolCounts).map(([name, count]) => {
            const Icon = getToolIcon(name);
            return (
              <span key={name} className={cn('flex items-center gap-0.5', getToolColor(name))}>
                <Icon className="h-3 w-3" />
                <span>{count}</span>
              </span>
            );
          })}
        </span>
        <span>{t('insights:insights.toolsUsed', { count: tools.length, s: tools.length !== 1 ? 's' : '' })}</span>
        <span className="text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 rounded-md border border-border bg-muted/30 p-2">
          {tools.map((tool, index) => {
            const Icon = getToolIcon(tool.name);
            return (
              <div
                key={`${tool.name}-${index}`}
                className="flex items-center gap-2 text-xs"
              >
                <Icon className={cn('h-3 w-3 shrink-0', getToolColor(tool.name))} />
                <span className="font-medium">{tool.name}</span>
                {tool.input && (
                  <span className="text-muted-foreground truncate max-w-[250px]">
                    {tool.input}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tool indicator component for showing what the AI is currently doing
interface ToolIndicatorProps {
  name: string;
  input?: string;
}

function ToolIndicator({ name, input }: ToolIndicatorProps) {
  const { t } = useTranslation('insights');
  // Get friendly name and icon for each tool
  const getToolInfo = (toolName: string) => {
    switch (toolName) {
      case 'Read':
        return {
          icon: FileText,
          label: t('insights:insights.readingFile'),
          color: 'text-blue-500 bg-blue-500/10'
        };
      case 'Glob':
        return {
          icon: FolderSearch,
          label: t('insights:insights.searchingFiles'),
          color: 'text-amber-500 bg-amber-500/10'
        };
      case 'Grep':
        return {
          icon: Search,
          label: t('insights:insights.searchingCode'),
          color: 'text-green-500 bg-green-500/10'
        };
      default:
        return {
          icon: Loader2,
          label: toolName,
          color: 'text-primary bg-primary/10'
        };
    }
  };

  const { icon: Icon, label, color } = getToolInfo(name);

  return (
    <div className={cn(
      'mt-2 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
      color
    )}>
      <Icon className="h-4 w-4 animate-pulse" />
      <span className="font-medium">{label}</span>
      {input && (
        <span className="text-muted-foreground truncate max-w-[300px]">
          {input}
        </span>
      )}
    </div>
  );
}

// Concurrent sessions indicator component
interface ConcurrentSessionsProps {
  sessions: InsightsSessionSummary[];
  abortControllers: Map<string, AbortController>;
  sessionStates: Map<string, InsightsSessionState>;
  currentSessionId: string | null;
  onAbortSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
}

function ConcurrentSessions({
  sessions,
  abortControllers,
  sessionStates,
  currentSessionId,
  onAbortSession,
  onSelectSession
}: ConcurrentSessionsProps) {
  const { t } = useTranslation('insights');
  // Get all active generating session IDs (sessions with abort controllers are generating)
  const activeSessionIds = Array.from(abortControllers.keys());

  // If only one or zero active sessions, don't show anything
  if (activeSessionIds.length <= 1) {
    return null;
  }

  // Map session IDs to session details
  const activeSessions = activeSessionIds
    .map((sessionId) => {
      const session = sessions.find((s) => s.id === sessionId);
      const sessionState = sessionStates.get(sessionId);
      return {
        id: sessionId,
        title: session?.title || `Session ${sessionId.slice(-8)}`,
        status: sessionState?.status,
        currentTool: sessionState?.currentTool,
        isCurrent: sessionId === currentSessionId
      };
    })
    .filter(Boolean);

  return (
    <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('insights:insights.concurrentSessions', { count: activeSessions.length })}</span>
      </div>
      <div className="space-y-2">
        {activeSessions.map((activeSession) => {
          const isStreaming = activeSession.status?.phase === 'streaming' || activeSession.status?.phase === 'thinking';
          const hasAbortController = abortControllers.has(activeSession.id);

          return (
            <div
              key={activeSession.id}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer transition-colors',
                activeSession.isCurrent ? 'bg-primary/10' : 'bg-muted/50 hover:bg-muted/70'
              )}
              onClick={() => !activeSession.isCurrent && onSelectSession(activeSession.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{activeSession.title}</span>
                  {activeSession.isCurrent && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {t('insights:insights.current')}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  {isStreaming && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span className="truncate">
                    {activeSession.currentTool
                      ? t('insights:insights.usingTool', { toolName: activeSession.currentTool.name })
                      : activeSession.status?.message || t('insights:insights.processing')}
                  </span>
                </div>
              </div>
              {hasAbortController && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAbortSession(activeSession.id);
                  }}
                  title={t('insights:insights.cancelSession')}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
