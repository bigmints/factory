"use client";
import React from "react";
import { useFactoryStore } from "@/stores/factory-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, CircleDashed, Cpu, ExternalLink, GitBranch, ShieldCheck, Zap, StopCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function QueueView() {
    const queueItems = useFactoryStore((s) => s.queueItems);
    const queueRunning = useFactoryStore((s) => s.queueRunning);
    const dgxStatus = useFactoryStore((s) => s.dgxStatus);
    const queueCapacity = useFactoryStore((s) => s.queueCapacity);
    const fetchAll = useFactoryStore((s) => s.fetchAll);

    const handleStopBuild = async () => {
        try {
            const res = await fetch("/api/queue/stop", { method: "POST" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to stop build");
            }
            toast.success("Build stopped");
            fetchAll();
        } catch (error: any) {
            toast.error("Failed to stop build", { description: error.message });
        }
    };

    const handleStartBuild = async () => {
        try {
            const res = await fetch("/api/queue/start", { method: "POST" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to start build");
            }
            toast.success("Build started");
            fetchAll();
        } catch (error: any) {
            toast.error("Failed to start build", { description: error.message });
        }
    };

    const handleRetry = async (file: string) => {
        try {
            const res = await fetch("/api/stories/update-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file, status: "queued" }),
            });
            if (res.ok) {
                toast.success("Story queued for retry");
                fetchAll();
            }
        } catch {}
    };

    return (
        <div className="w-full max-w-4xl mx-auto py-3 sm:py-6 flex flex-col gap-4 sm:gap-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Execution Queue</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Factory runs queued stories through the Pi SDK and updates their execution state here.
                    </p>
                </div>
                <div className="shrink-0">
                    {queueRunning ? (
                        <Button
                            variant="destructive"
                            onClick={handleStopBuild}
                            className="w-full sm:w-auto gap-2"
                        >
                            <StopCircle className="h-4 w-4" /> Stop Queue
                        </Button>
                    ) : (
                        <Button
                            onClick={handleStartBuild}
                            className="w-full sm:w-auto gap-2"
                            disabled={queueItems.length === 0}
                        >
                            <Zap className="h-4 w-4" /> Start Queue
                        </Button>
                    )}
                </div>
            </div>

            <Card className="border-border/60 bg-card/60">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", dgxStatus?.state === "ready" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500")}>
                            {dgxStatus?.state === "ready" ? <Cpu className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold">DGX Spark {dgxStatus?.state === "ready" ? "ready" : "unavailable"}</p>
                            <p className="truncate text-xs text-muted-foreground">
                                {dgxStatus?.state === "ready"
                                    ? `${dgxStatus.model} · ${dgxStatus.endpointHost} · ${dgxStatus.latencyMs}ms`
                                    : dgxStatus?.error || "Waiting for health check"}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{queueCapacity?.activeWorkers || 0}/{queueCapacity?.maxWorkers || 1} worker</Badge>
                        <Badge variant="outline">Unattended {queueCapacity?.unattendedEnabled ? "on" : "off"}</Badge>
                        {queueCapacity?.humanMergeRequired && <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Human merge</Badge>}
                    </div>
                </CardContent>
            </Card>

            {queueItems.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <CircleDashed className="h-12 w-12 text-muted-foreground/50 mb-4" />
                        <p className="text-lg font-medium text-foreground">Queue is Empty</p>
                        <p className="text-sm text-muted-foreground max-w-sm text-center mt-1">
                            Add stories to the queue from the Stories board to see them here.
                        </p>
                    </CardContent>
                </Card>
            ) : (() => {
                const activeQueue = queueItems
                    .filter(item => item.status !== "done")
                    .sort((a, b) => {
                        const getScore = (status: string) => {
                            if (status === "running") return 0;
                            if (status === "review") return 1;
                            if (status === "failed") return 2;
                            return 2;
                        };
                        return getScore(a.status) - getScore(b.status);
                    });

                if (activeQueue.length === 0) {
                    return (
                        <Card className="border-dashed">
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <CheckCircle2 className="h-12 w-12 text-emerald-500/50 mb-4" />
                                <p className="text-lg font-medium text-foreground">All Caught Up</p>
                                <p className="text-sm text-muted-foreground max-w-sm text-center mt-1">
                                    All stories in the queue have been completed.
                                </p>
                            </CardContent>
                        </Card>
                    );
                }

                return (
                <div className="flex flex-col gap-3 relative">
                    {activeQueue.map((item, index) => {
                        const isRunning = item.status === "running";
                        const isReview = item.status === "review";
                        const isFailed = item.status === "failed";
                        const isDone = item.status === "done";
                        const isPending = item.status === "queued";

                        return (
                            <Card
                                key={item.id}
                                className={cn(
                                    "overflow-hidden transition-colors relative",
                                    isRunning && "border-primary/50 shadow-sm shadow-primary/10",
                                    isReview && "border-amber-500/50",
                                    isFailed && "border-destructive/50",
                                    isDone && "opacity-60"
                                )}
                            >
                                {isRunning && (
                                    <div className="absolute top-0 left-0 bottom-0 w-1 bg-primary animate-pulse" />
                                )}
                                <CardContent className="p-3 sm:p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                                        <div className="flex-shrink-0 flex flex-col items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted text-muted-foreground font-mono text-xs sm:text-sm">
                                            {index + 1}
                                        </div>
                                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                                            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                                                <h3 className="min-w-0 truncate font-semibold text-foreground">
                                                    {(item as any).title || item.storyFile.split('/').pop()}
                                                </h3>
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                {isRunning && (
                                                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 gap-1.5 h-5 px-1.5 rounded-sm">
                                                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                                        Running
                                                    </Badge>
                                                )}
                                                {isFailed && (
                                                    <Badge variant="destructive" className="h-5 px-1.5 rounded-sm">
                                                        Failed
                                                    </Badge>
                                                )}
                                                {isReview && (
                                                    <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 h-5 px-1.5 rounded-sm">
                                                        Review
                                                    </Badge>
                                                )}
                                                {isDone && (
                                                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 h-5 px-1.5 rounded-sm">
                                                        Done
                                                    </Badge>
                                                )}
                                                {isPending && (
                                                    <Badge variant="secondary" className="h-5 px-1.5 rounded-sm font-normal text-muted-foreground">
                                                        Queued
                                                    </Badge>
                                                )}
                                                </div>
                                            </div>
                                            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                <span className="min-w-0 max-w-full truncate font-mono sm:max-w-[200px]">
                                                    {item.storyFile.split('/').pop()}
                                                </span>
                                                {(item.phase !== undefined) && (
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                                                        Phase {item.phase}
                                                    </span>
                                                )}
                                                {item.dependsOn && item.dependsOn.length > 0 && (
                                                    <span className="flex items-center gap-1 truncate max-w-[200px]" title={item.dependsOn.join(", ")}>
                                                        <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                                                        Requires: {item.dependsOn.length} dep{item.dependsOn.length > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>
                                            {item.execution && (
                                                <div className="mt-1 grid gap-1 rounded-md border border-border/40 bg-muted/20 p-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                                                    <span className="truncate"><Cpu className="mr-1 inline h-3 w-3" />{item.execution.model} · {item.execution.endpointHost}</span>
                                                    <span className="truncate"><GitBranch className="mr-1 inline h-3 w-3" />{item.execution.branch}</span>
                                                    <span>{item.execution.changedFiles?.length || 0} product file{item.execution.changedFiles?.length === 1 ? "" : "s"}</span>
                                                    <span>{item.execution.verification?.status || item.execution.state || "claimed"}</span>
                                                    {item.execution.lastEvent && <span className="sm:col-span-2 line-clamp-1">{item.execution.lastEvent}</span>}
                                                    {item.execution.prUrl && (
                                                        <a className="sm:col-span-2 inline-flex items-center gap-1 text-primary hover:underline" href={item.execution.prUrl} target="_blank" rel="noreferrer">
                                                            PR #{item.execution.prNumber} <ExternalLink className="h-3 w-3" />
                                                        </a>
                                                    )}
                                                </div>
                                            )}
                                            {(isFailed || isReview) && item.error && (
                                                <p className={cn("text-xs line-clamp-2", isReview ? "text-amber-500/85" : "text-destructive/85")}>
                                                    {item.error}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-end gap-2 flex-shrink-0">
                                        {(isFailed || isReview) && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 gap-1"
                                                onClick={() => handleRetry(item.storyFile)}
                                            >
                                                <RefreshCw className="h-3.5 w-3.5" /> Requeue
                                            </Button>
                                        )}
                                        {isDone && (
                                            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
                );
            })()}
        </div>
    );
}
