import type { LucideIcon } from 'lucide-react';
import {
  BarChart3, Boxes, ClipboardCheck, Factory, FileText, Gauge,
  Truck, UsersRound, Warehouse, CalendarRange, PackageCheck, UserCog, Database,
  Ruler, SlidersHorizontal, GitBranch, ListOrdered, RotateCcw, Undo2
} from 'lucide-react';

export type MesScreen = {
  screenNo: string;
  screenCode: string;
  title: string;
  route: string;
  icon: LucideIcon;
  description?: string;
  moduleCode: string;
};

export type MesModule = {
  code: string;
  name: string;
  number: string;
  icon: LucideIcon;
  route: string;
  description: string;
  screens: MesScreen[];
};

export const overviewScreen: MesScreen = {
  screenNo: '0001', screenCode:'MES_OVERVIEW', title: 'MES Overview', route: '/', icon: Gauge,
  description: 'Enterprise manufacturing overview', moduleCode: 'MES'
};

// v0.10.8 principle: expose only implemented, usable business modules/screens.
// Planned shells remain in source/database history but are intentionally hidden from the UI
// until their business process is actually developed.
export const modules: MesModule[] = [
  {
    code: 'RMS', number: '1', name: 'RM Stores', icon: Warehouse,
    route: '/grn',
    description: 'Raw-material receipt, traceability and inventory',
    screens: [
      { screenNo:'1101', screenCode:'RMS_GRN_MONITOR', title:'GRN Monitor', route:'/grn', icon:Truck, moduleCode:'RMS' },
      { screenNo:'1102', screenCode:'RMS_RM_INVENTORY', title:'RM Inventory', route:'/inventory', icon:PackageCheck, moduleCode:'RMS' },
      { screenNo:'1103', screenCode:'RMS_REVERSAL_REPORT', title:'RM Reversal Report', route:'/rm-reversals', icon:RotateCcw, moduleCode:'RMS' },
      { screenNo:'1104', screenCode:'RMS_GRN_QC_REVERSAL', title:'GRN / QC Reversal', route:'/rm-reversal-entry', icon:Undo2, moduleCode:'RMS' },
    ]
  },
  {
    code: 'PLN', number: '2', name: 'Planning', icon: CalendarRange,
    route: '/planning/sales-orders',
    description: 'Sales-order visibility and planning foundation',
    screens: [
      { screenNo:'2101', screenCode:'PLN_SAP_SO_MONITOR', title:'SAP Sales Order Monitor', route:'/planning/sales-orders', icon:ListOrdered, moduleCode:'PLN' },
    ]
  },
  {
    code: 'QLT', number: '4', name: 'Quality', icon: ClipboardCheck,
    route: '/quality',
    description: 'RM usage decision and technical delivery controls',
    screens: [
      { screenNo:'4101', screenCode:'QLT_RM_UD', title:'RM Usage Decision', route:'/quality', icon:ClipboardCheck, moduleCode:'QLT' },
      { screenNo:'4200', screenCode:'QLT_TDC_TEMPLATE', title:'TDC Template Master', route:'/quality/tdc-templates', icon:SlidersHorizontal, moduleCode:'QLT' },
      { screenNo:'4201', screenCode:'QLT_TDC', title:'TDC Register', route:'/quality/tdc', icon:FileText, moduleCode:'QLT' },
      { screenNo:'4202', screenCode:'QLT_TDC_REVISION', title:'TDC Create / Revise Wizard', route:'/quality/tdc/create', icon:FileText, moduleCode:'QLT' },
      { screenNo:'4203', screenCode:'QLT_TDC_APPROVAL', title:'TDC Approval', route:'/quality/tdc-approval', icon:ClipboardCheck, moduleCode:'QLT' },
    ]
  },
  {
    code: 'RPT', number: '6', name: 'Reports', icon: BarChart3,
    route: '/suppliers',
    description: 'Implemented operational and stock analysis',
    screens: [
      { screenNo:'6101', screenCode:'RPT_SUPPLIER', title:'Supplier Report', route:'/suppliers', icon:UsersRound, moduleCode:'RPT' },
      { screenNo:'6109', screenCode:'RPT_PLANT_STOCK', title:'Plant Stock Report', route:'/reports/plant-stock', icon:Warehouse, moduleCode:'RPT' },
    ]
  },
  {
    code: 'MDM', number: '7', name: 'Masters', icon: Database,
    route: '/masters/thickness-matrix',
    description: 'Manufacturing master data for planning, production and quality',
    screens: [
      { screenNo:'7101', screenCode:'MDM_THICKNESS_MATRIX', title:'Thickness Matrix', route:'/masters/thickness-matrix', icon:Ruler, moduleCode:'MDM' },
      { screenNo:'7102', screenCode:'MDM_WORK_CENTERS', title:'Work Center Master', route:'/masters/work-centers', icon:Factory, moduleCode:'MDM' },
      { screenNo:'7103', screenCode:'MDM_WC_TOLERANCE', title:'Work Center Tolerance Matrix', route:'/masters/work-center-tolerance', icon:SlidersHorizontal, moduleCode:'MDM' },
      { screenNo:'7104', screenCode:'MDM_GROUP_CODES', title:'Group Code & Dynamic Controls', route:'/masters/group-codes', icon:SlidersHorizontal, moduleCode:'MDM' },
      { screenNo:'7105', screenCode:'MDM_OPERATIONS', title:'Operation Master', route:'/masters/operations', icon:Factory, moduleCode:'MDM' },
      { screenNo:'7106', screenCode:'MDM_MATERIALS', title:'Material Master', route:'/masters/materials', icon:Boxes, moduleCode:'MDM' },
      { screenNo:'7107', screenCode:'MDM_ROUTES', title:'Route Master', route:'/masters/routes', icon:GitBranch, moduleCode:'MDM' },
    ]
  },
];

// Keep Administration equally simple: only screens that are in active use.
export const adminScreens: MesScreen[] = [
  { screenNo:'9001', screenCode:'ADM_USERS', title:'User Management', route:'/admin/users', icon:UserCog, moduleCode:'ADM' },
  { screenNo:'9003', screenCode:'ADM_USER_MAINTENANCE', title:'User Maintenance', route:'/admin/users/manage', icon:UserCog, moduleCode:'ADM' },
];

export const allScreens: MesScreen[] = [
  overviewScreen,
  ...modules.flatMap(m=>m.screens),
  ...adminScreens,
];

export const moduleByCode = (code?: string) => modules.find(m=>m.code===code);
export const screenByNo = (screenNo?: string) => allScreens.find(s=>s.screenNo===String(screenNo||'').trim());
export const screenByPath = (pathname: string) => {
  const exact = allScreens.find(s=>s.route===pathname);
  if(exact) return exact;
  return [...allScreens]
    .filter(s=>s.route!=='/' && pathname.startsWith(`${s.route}/`))
    .sort((a,b)=>b.route.length-a.route.length)[0] || overviewScreen;
};

export const screenByCode = (screenCode?: string) => allScreens.find(s=>s.screenCode===String(screenCode||'').trim().toUpperCase());
