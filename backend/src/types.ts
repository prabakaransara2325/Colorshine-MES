export type JwtUser = {
  userId: string;
  username: string;
  displayName: string;
  email?: string | null;
  employeeId?: string | null;
  department?: string | null;
  designation?: string | null;
  mobileNo?: string | null;
  plantCode: string | null;
  roles: string[];
  authorizedPlants: Array<{companyCode:string;companyShortName:string;plantCode:string;plantName:string}>;
  accessGroups: Array<{groupCode:string;groupName:string;groupType:string;allowConsolidatedView:boolean}>;
  canViewConsolidated: boolean;
  mustChangePassword?: boolean;
  accountLocked?: boolean;
};

declare global {
  namespace Express {
    interface Request { user?: JwtUser; requestId?: string; }
  }
}
export {};
