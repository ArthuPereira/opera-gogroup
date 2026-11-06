"use client";

import React from "react";
import {
  Download,
  FileCheck2,
  FolderKanban,
  LayoutDashboard,
  Plus,
  Radar,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";

export type DashboardSection =
  | "overview"
  | "queue"
  | "radar"
  | "triage"
  | "claims";

interface SidebarProps {
  activeSection: DashboardSection;
  onSelectSection: (section: DashboardSection) => void;
  queueCount: number;
  anomaliesCount: number;
  activeContainmentsCount: number;
  autoTriagedCount: number;
  claimsCount: number;
  exportCount: number;
  onOpenIngest: () => void;
  onExportCsv: () => void;
  onResetData: () => void;
  isResetting: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeSection,
  onSelectSection,
  queueCount,
  anomaliesCount,
  activeContainmentsCount,
  autoTriagedCount,
  claimsCount,
  exportCount,
  onOpenIngest,
  onExportCsv,
  onResetData,
  isResetting,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navItems: Array<{
    id: DashboardSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
    badgeTone?: "default" | "emerald" | "amber";
  }> = [
    {
      id: "overview",
      label: "Visão Geral",
      icon: LayoutDashboard,
    },
    {
      id: "queue",
      label: "Fila de Tratativas",
      icon: FolderKanban,
      badge: queueCount,
    },
    {
      id: "radar",
      label: "Causas-Raiz",
      icon: Radar,
      badge:
        activeContainmentsCount > 0
          ? `${activeContainmentsCount}/${anomaliesCount}`
          : anomaliesCount,
      badgeTone: activeContainmentsCount > 0 ? "emerald" : "default",
    },
    {
      id: "triage",
      label: "Triagem Automática",
      icon: Zap,
      badge: autoTriagedCount,
    },
    {
      id: "claims",
      label: "Sinistros & Histórico",
      icon: FileCheck2,
      badge: claimsCount > 0 ? claimsCount : undefined,
      badgeTone: "emerald",
    },
  ];

  const content = (
    <div className="flex h-full w-60 flex-col border-r border-slate-200 bg-slate-950 text-slate-200">
      {/* Brand */}
      <div className="flex h-14 items-center justify-between border-b border-slate-800/80 px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 font-bold text-slate-950 text-sm">
            O
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white leading-none">
              Opera
            </div>
            <div className="mt-0.5 text-[10px] font-medium text-slate-400">
              Operações Gogroup
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Primary CTA */}
      <div className="p-3">
        <button
          type="button"
          onClick={() => {
            onOpenIngest();
            onCloseMobile();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 shadow-sm transition hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          Adicionar Pedidos
        </button>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 space-y-1 px-3 py-1">
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Navegação
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectSection(item.id);
                onCloseMobile();
              }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition ${
                active
                  ? "bg-slate-800 text-white font-semibold shadow-sm"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon
                  className={`h-4 w-4 ${
                    active ? "text-emerald-400" : "text-slate-500"
                  }`}
                />
                {item.label}
              </span>

              {item.badge !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    item.badgeTone === "emerald"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : active
                      ? "bg-slate-700 text-slate-200"
                      : "bg-slate-900 text-slate-400"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Actions */}
      <div className="space-y-1.5 border-t border-slate-800/80 p-3">
        <button
          type="button"
          onClick={onExportCsv}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-slate-900 hover:text-white"
        >
          <span className="flex items-center gap-2">
            <Download className="h-3.5 w-3.5 text-slate-400" />
            Exportar CSV
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {exportCount}
          </span>
        </button>

        <button
          type="button"
          onClick={onResetData}
          disabled={isResetting}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 transition hover:bg-slate-900 hover:text-rose-300 disabled:opacity-50"
        >
          <RotateCcw
            className={`h-3.5 w-3.5 ${isResetting ? "animate-spin" : ""}`}
          />
          Restaurar dados
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block lg:shrink-0">{content}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 flex h-full">{content}</div>
        </div>
      )}
    </>
  );
}
