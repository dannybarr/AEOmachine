import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Redirect,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { Shell } from '@/components/layout/Shell';
import NotFound from '@/pages/not-found';
import Overview from '@/pages/overview';
import Progress from '@/pages/progress';
import Prompts from '@/pages/prompts';
import PromptDetail from '@/pages/prompt-detail';
import Chats from '@/pages/chats';
import ChatDetail from '@/pages/chat-detail';
import Signals from '@/pages/signals';
import Lab from '@/pages/lab';
import LabDetail from '@/pages/lab-detail';
import LabStrategy from '@/pages/lab-strategy';

import Home from '@/pages/home';
import Dashboard from '@/pages/dashboard';
import Insights from '@/pages/insights';
import Perception from '@/pages/perception';
import GapAnalysis from '@/pages/gap-analysis';
import Domains from '@/pages/domains';
import Urls from '@/pages/urls';
import Discovery from '@/pages/discovery';
import Settings from '@/pages/settings';
import CaseStudies from '@/pages/case-studies';
import Audit from '@/pages/audit';
import { CompanyProvider } from '@/components/CompanyContext';

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/overview" component={Overview} />
          <Route path="/progress" component={Progress} />
          <Route path="/home" component={Home} />
          <Route path="/dashboard">
            <Redirect to={`/${window.location.search}`} replace />
          </Route>
          <Route path="/insights" component={Insights} />
          <Route path="/perception" component={Perception} />
          <Route path="/gap-analysis" component={GapAnalysis} />
          <Route path="/domains" component={Domains} />
          <Route path="/urls" component={Urls} />
          <Route path="/audit" component={Audit} />
          <Route path="/discovery" component={Discovery} />
          <Route path="/settings" component={Settings} />
          <Route path="/settings/case-studies" component={CaseStudies} />
          <Route path="/prompts" component={Prompts} />
          <Route path="/prompts/:id" component={PromptDetail} />
          <Route path="/chats" component={Chats} />
          <Route path="/chats/:id" component={ChatDetail} />
          <Route path="/signals" component={Signals} />
          <Route path="/lab" component={Lab} />
          <Route path="/lab/strategy/:companyId" component={LabStrategy} />
          <Route path="/lab/:id" component={LabDetail} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <CompanyProvider>
            <Router />
          </CompanyProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
