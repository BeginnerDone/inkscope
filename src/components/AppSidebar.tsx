import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { BookSummary } from "@/types";
import { BookOpen, Home, Plus, Search, Settings, PenLine } from "lucide-react";

export function AppSidebar({
  view,
  books,
  selected,
  onHome,
  onNew,
  onCreation,
  onOpen,
  onSettings,
  onSearch,
}: {
  view: string;
  books: BookSummary[];
  selected: BookSummary | null;
  onHome: () => void;
  onNew: () => void;
  onCreation: () => void;
  onOpen: (book: BookSummary) => void;
  onSettings: () => void;
  onSearch: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  const navigate = (action: () => void) => {
    action();
    setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <div className="brand">
          <div className="brand-mark">
            <BookOpen size={18} />
          </div>
          <div>
            <strong>InkScope</strong>
            <small>阅读、灵感与创作</small>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => navigate(onSearch)}>
              <Search />
              <span>搜索书库</span>
              <kbd className="ml-auto">⌘ K</kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === "home"}
                  onClick={() => navigate(onHome)}
                >
                  <Home />
                  <span>我的书架</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {books.length}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === "import"}
                  onClick={() => navigate(onNew)}
                >
                  <Plus />
                  <span>添加书籍</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === "creation"}
                  onClick={() => navigate(onCreation)}
                >
                  <PenLine />
                  <span>创作空间</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>最近阅读</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {books.slice(0, 7).map((book) => (
                <SidebarMenuItem key={book.id}>
                  <SidebarMenuButton
                    isActive={
                      view !== "home" &&
                      view !== "import" &&
                      view !== "creation" &&
                      selected?.id === book.id
                    }
                    onClick={() => navigate(() => onOpen(book))}
                    title={book.title}
                  >
                    <BookOpen />
                    <span>{book.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            {!books.length && (
              <p className="sidebar-empty">添加书籍后，在这里继续阅读</p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="local-note">
          <span className="status-dot completed" />
          书籍保存在本机
        </div>
        <Separator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => navigate(onSettings)}>
              <Settings />
              <span>模型与设置</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
