import {
  BadgeDollarSign,
  BarChart3,
  Bot,
  Boxes,
  Brain,
  Building2,
  ChevronDown,
  Cpu,
  FileBarChart,
  Home,
  Megaphone,
  Package,
  Settings,
  ShoppingCart,
  Store,
  Users,
  Workflow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationLink = {
  type?: "link";
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavigationGroup = {
  type: "group";
  label: string;
  icon: LucideIcon;
  indicatorIcon: typeof ChevronDown;
  children: Array<{ label: string; href: string }>;
};

export type NavigationItem = NavigationLink | NavigationGroup;

export const navigationItems: NavigationItem[] = [
  { label: "Dashboard", href: "/", icon: Home },
  { label: "Clientes", href: "/clients", icon: Users },
  {
    type: "group",
    label: "Operacoes",
    icon: Workflow,
    indicatorIcon: ChevronDown,
    children: [
      { label: "Visao Geral", href: "/operations" },
      { label: "Central Matrix", href: "/matrix" },
      { label: "Automacoes", href: "/automations" },
      { label: "Publicacoes", href: "/publications" },
      { label: "Fila de Jobs", href: "/operations/queue" },
      { label: "Logs de Sincronizacao", href: "/operations/logs" }
    ]
  },
  { label: "Produtos", href: "/products", icon: Package },
  { label: "Pedidos", href: "/orders", icon: ShoppingCart },
  {
    type: "group",
    label: "Financeiro",
    icon: BadgeDollarSign,
    indicatorIcon: ChevronDown,
    children: [
      { label: "Visao Geral", href: "/finance" },
      { label: "Assinaturas", href: "/finance/subscriptions" },
      { label: "Faturas", href: "/finance/invoices" },
      { label: "Cobrancas", href: "/finance/billing" }
    ]
  },
  { label: "Marketplaces", href: "/marketplaces", icon: Store },
  { label: "ERPS", href: "/erps", icon: Cpu },
  { label: "IA", href: "/ia", icon: Brain },
  { label: "Relatorios", href: "/reports", icon: FileBarChart },
  { label: "Anuncios", href: "/ads", icon: Megaphone },
  { label: "Precificacao", href: "/pricing", icon: BarChart3 },
  { label: "Integracoes", href: "/integrations", icon: Building2 },
  { label: "Estoque", href: "/inventory", icon: Boxes },
  { label: "IA Assistente", href: "/ai", icon: Bot },
  { label: "Configuracoes", href: "/settings", icon: Settings }
];
