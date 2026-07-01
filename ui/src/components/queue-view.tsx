"use client";
import React from "react";
import { useFactoryStore } from "@/stores/factory-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleDashed, Terminal, Zap, StopCircle, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function QueueView() {
    const queueItems = useFactoryStore((s) => s.queueItems);
    const queueRunning = useFactoryStore((s) => s.queueRunning);
    const fetchAll = useFactoryStore((s) => s.fetchAll);

    const handleStopBuild = async () => {
        try {
            await fetch("/api/queue/stop", { method: "POST" });
            toast.success("Build stopped");
            fetchAll();
        } catch {
            toast.error("Failed to stop build");
        }
    };

    const handleStartBuild = async () => {
        try {
            await fetch("/api/queue/start", { method: "POST" });
            toast.success("Build started");
            fetchAll();
        } catch {
            toast.error("Failed to start build");
        }
    };

    const handleRetry = async (file: string) => {
        try {
            const res = await fetch("/api/stories/update-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file, status: "ready-to-build" }),
            });
            if (res.ok) {
                toast.success("Story queued for retry");
                fetchAll();
            }
        } catch {}
    };

    return (
        <div className="w-full max-w-4xl mx-auto py-6 flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Build Queue</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Stories are executed sequentially according to their dependencies and phase.
                    </p>
                </div>
                <div>
                    {queueRunning ? (
                        <Button
                            variant="destructive"
                            onClick={handleStopBuild}
                            className="gap-2"
                        >
                            <StopCircle className="h-4 w-4" /> Stop Queue
                        </Button>
                    ) : (
                        <Button
                            onClick={handleStartBuild}
                            className="gap-2"
                            disabled={queueItems.length === 0}
                        >
                            <Zap className="h-4 w-4" /> Start Queue
                        </Button>
                    )}
                </div>
            </div>

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
                    .filter(item => item.status !== "done" && item.status !== "completed")
                    .sort((a, b) => {
                        const getScore = (status: string) => {
                            if (status === "running" || status === "building") return 0;
                            if (status === "failed") return 1;
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
                        const isRunning = item.status === "running" || item.status === "building";
                        const isFailed = item.status === "failed";
                        const isDone = item.status === "done" || item.status === "completed";
                        const isPending = item.status === "pending" || item.status === "ready-to-build";

                        return (
                            <Card
                                key={item.id}
                                className={cn(
                                    "overflow-hidden transition-colors relative",
                                    isRunning && "border-primary/50 shadow-sm shadow-primary/10",
                                    isFailed && "border-destructive/50",
                                    isDone && "opacity-60"
                                )}
                            >
                                {isRunning && (
                                    <div className="absolute top-0 left-0 bottom-0 w-1 bg-primary animate-pulse" />
                                )}
                                <CardContent className="p-4 flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className="flex-shrink-0 flex flex-col items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground font-mono text-sm">
                                            {index + 1}
                                        </div>
                                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold text-foreground truncate">
                                                    {(item as any).title || item.storyFile.split('/').pop()}
                                                </h3>
                                                {isRunning && (
                                                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 gap-1.5 h-5 px-1.5 rounded-sm">
                                                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                                        Building
                                                    </Badge>
                                                )}
                                                {isFailed && (
                                                    <Badge variant="destructive" className="h-5 px-1.5 rounded-sm">
                                                        Failed
                                                    </Badge>
                                                )}
                                                {isDone && (
                                                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 h-5 px-1.5 rounded-sm">
                                                        Done
                                                    </Badge>
                                                )}
                                                {isPending && (
                                                    <Badge variant="secondary" className="h-5 px-1.5 rounded-sm font-normal text-muted-foreground">
                                                        Pending
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                <span className="font-mono truncate max-w-[200px]">
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
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {isFailed && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 gap-1"
                                                onClick={() => handleRetry(item.storyFile)}
                                            >
                                                <RefreshCw className="h-3.5 w-3.5" /> Retry
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
