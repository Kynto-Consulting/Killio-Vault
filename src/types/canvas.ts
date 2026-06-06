export type WidgetType =
  | "text_block"
  | "image_base64"
  | "table"
  | "graph_plot"
  | "accordion"
  | "link_block"
  | "checklist";

export interface Widget {
  id: string;
  type: WidgetType;
  title?: string;
  content?: string; // HTML or Markdown
  is_completed?: boolean;
  position?: number;
  parentId?: string;
  children?: Widget[];

  // Specific data
  tableData?: string[][];
  graphConfig?: {
    type: 'line' | 'bar' | 'pie';
    xAxis?: string;
    yAxis?: string;
    showGrid?: boolean;
  };
  linkData?: {
    url: string;
    title?: string;
    description?: string;
    provider?: string;
  };
  checklistData?: {
    items: { id: string; label: string; checked: boolean }[];
  };
  accordionData?: {
    isExpanded?: boolean;
    body?: string;
  };
}

export interface SyllabusSection {
  id: string;
  title: string;
  is_completed: boolean;
  widgets: Widget[];
}

export interface ProjectState {
  project: {
    title: string;
    student_name: string;
  };
  syllabus_sections: SyllabusSection[];
  meta: {
    version: string;
    last_modified: string;
    theme: string;
    grid_columns?: number;
  };
}
