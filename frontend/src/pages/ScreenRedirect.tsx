import { Navigate, useParams } from 'react-router-dom';
import { screenByNo } from '../navigation';

export default function ScreenRedirect(){
  const {screenNo}=useParams();
  const screen=screenByNo(screenNo);
  return <Navigate to={screen?.route||'/'} replace/>;
}
