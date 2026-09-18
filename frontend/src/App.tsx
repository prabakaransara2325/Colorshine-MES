import {Navigate,Route,Routes} from 'react-router-dom';
import Shell from './components/Shell';
import Dashboard from './pages/Dashboard';
import GRN from './pages/GRN';
import Quality from './pages/Quality';
import Inventory from './pages/Inventory';
import Suppliers from './pages/Suppliers';
import TDC from './pages/TDC';
import TDCTemplateMaster from './pages/TDCTemplateMaster';
import TDCWizard from './pages/TDCWizard';
import TDCApproval from './pages/TDCApproval';
import Login from './pages/Login';
import Users from './pages/Users';
import UserEditor from './pages/UserEditor';
import ChangePassword from './pages/ChangePassword';
import MastersDashboard from './pages/MastersDashboard';
import ScreenRedirect from './pages/ScreenRedirect';
import ThicknessMatrix from './pages/ThicknessMatrix';
import WorkCenters from './pages/WorkCenters';
import WorkCenterTolerance from './pages/WorkCenterTolerance';
import PlantStockReport from './pages/PlantStockReport';
import GroupCodes from './pages/GroupCodes';
import OperationMaster from './pages/OperationMaster';
import MaterialMaster from './pages/MaterialMaster';
import RouteMaster from './pages/RouteMaster';
import RMStoresDashboard from './pages/RMStoresDashboard';
import SalesOrderMonitor from './pages/SalesOrderMonitor';
import {currentUser,token} from './lib/api';

function ProtectedShell(){
  if(!token())return <Navigate to="/login" replace/>;
  if(currentUser()?.mustChangePassword)return <Navigate to="/change-password" replace/>;
  return <Shell/>;
}
function ProtectedPassword(){return token()?<ChangePassword/>:<Navigate to="/login" replace/>}

export default function App(){return <Routes>
  <Route path="/login" element={<Login/>}/>
  <Route path="/change-password" element={<ProtectedPassword/>}/>
  <Route element={<ProtectedShell/>}>
    <Route path="/" element={<Dashboard/>}/>

    <Route path="/modules/rm-stores" element={<RMStoresDashboard/>}/>
    <Route path="/grn" element={<GRN/>}/>
    <Route path="/inventory" element={<Inventory/>}/>

    <Route path="/planning/sales-orders" element={<SalesOrderMonitor/>}/>
    <Route path="/modules/planning" element={<Navigate to="/planning/sales-orders" replace/>}/>

    <Route path="/quality" element={<Quality/>}/>
    <Route path="/quality/tdc-templates" element={<TDCTemplateMaster/>}/>
    <Route path="/quality/tdc" element={<TDC/>}/>
    <Route path="/quality/tdc/create" element={<TDCWizard/>}/>
    <Route path="/quality/tdc-approval" element={<TDCApproval/>}/>
    <Route path="/tdc" element={<Navigate to="/quality/tdc" replace/>}/>
    <Route path="/modules/quality" element={<Navigate to="/quality" replace/>}/>

    <Route path="/suppliers" element={<Suppliers/>}/>
    <Route path="/reports/plant-stock" element={<PlantStockReport/>}/>
    <Route path="/modules/reports" element={<Navigate to="/suppliers" replace/>}/>

    <Route path="/modules/masters" element={<MastersDashboard/>}/>
    <Route path="/masters" element={<Navigate to="/modules/masters" replace/>}/>
    <Route path="/masters/thickness-matrix" element={<ThicknessMatrix/>}/>
    <Route path="/masters/work-centers" element={<WorkCenters/>}/>
    <Route path="/masters/work-center-tolerance" element={<WorkCenterTolerance/>}/>
    <Route path="/masters/group-codes" element={<GroupCodes/>}/>
    <Route path="/masters/operations" element={<OperationMaster/>}/>
    <Route path="/masters/materials" element={<MaterialMaster/>}/>
    <Route path="/masters/routes" element={<RouteMaster/>}/>

    <Route path="/admin/users" element={<Users/>}/>
    <Route path="/admin/users/manage" element={<UserEditor/>}/>
    <Route path="/admin/users/manage/:userId" element={<UserEditor/>}/>

    {/* Old placeholder dashboard URLs intentionally redirect to the live MES Overview. */}
    <Route path="/modules/production" element={<Navigate to="/" replace/>}/>
    <Route path="/modules/maintenance" element={<Navigate to="/" replace/>}/>
    <Route path="/admin/reference-masters" element={<Navigate to="/modules/masters" replace/>}/>

    <Route path="/screen/:screenNo" element={<ScreenRedirect/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Route>
</Routes>}
