import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { About, DivisionDetail, Divisions, Home, Leadership, News, NewsDetail } from "./pages/Public";
import { Complaint } from "./pages/Resources";
import { Community, Contact, Policy, TrackingPage } from "./pages/Community";
import { PortalAnnouncements, PortalCalendar, PortalCertificate, PortalDocuments, PortalHome, PortalLayout, PortalLeaderboard, PortalMessages, PortalMisconduct, PortalNotifications, PortalProfile, PortalRequests, PortalRoster, PortalSearch, PortalTitle } from "./pages/Portal";
import { CourseDetail, ReportDetail, ReportNew, Reports, Training } from "./pages/Records";
import { AdminLayout, AdminLogin, RequirePerm } from "./pages/admin/AdminLayout";
import { AdminDivisions, AdminDocuments, AdminLeadership, AdminNews, AdminOverview, AdminRoster, AdminRosterDividers } from "./pages/admin/ContentAdmin";
import { Accounts, ChangePassword, IACases, IADetail, IAList, RolesAdmin, Settings } from "./pages/admin/StaffAdmin";
import { ActivityAdmin, AuditAdmin, DisciplineAdmin, MemberAdmin, PersonnelDirectory, RequestsAdmin } from "./pages/admin/CommandAdmin";
import { AnnouncementsAdmin, BroadcastAdmin, CoursesAdmin, EventsAdmin, FaqAdmin, FeedbackAdmin, PagesAdmin, RanksAdmin, SiteConfigAdmin, TrainingRecordsAdmin, UnitMembersAdmin } from "./pages/admin/OperationsAdmin";

function NotFound() {
  return (
    <section className="section">
      <div className="wrap center">
        <p className="eyebrow">404</p>
        <h1 className="section-title">Page not found</h1>
        <hr className="rule" />
        <Link to="/" className="btn btn-gold">Back to Home</Link>
      </div>
    </section>
  );
}

function PortalAlias() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`/portal${pathname}${search}${hash}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="about" element={<About />} />
        <Route path="divisions" element={<Divisions />} />
        <Route path="divisions/:id" element={<DivisionDetail />} />
        <Route path="leadership" element={<Leadership />} />
        <Route path="news" element={<News />} />
        <Route path="news/:id" element={<NewsDetail />} />
        <Route path="community" element={<Community />} />
        <Route path="contact" element={<Contact />} />
        <Route path="policies/:slug" element={<Policy />} />
        <Route path="complaint" element={<Complaint />} />
        <Route path="complaint/status" element={<TrackingPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="training/*" element={<PortalAlias />} />
      <Route path="reports/*" element={<PortalAlias />} />
      <Route path="portal" element={<PortalLayout />}>
        <Route index element={<PortalHome />} />
        <Route path="roster" element={<PortalRoster />} />
        <Route path="profile" element={<PortalProfile />} />
        <Route path="messages" element={<PortalMessages />} />
        <Route path="notifications" element={<PortalNotifications />} />
        <Route path="announcements" element={<PortalAnnouncements />} />
        <Route path="calendar" element={<><PortalTitle title="Calendar" /><PortalCalendar /></>} />
        <Route path="requests" element={<PortalRequests />} />
        <Route path="documents" element={<PortalDocuments />} />
        <Route path="misconduct" element={<PortalMisconduct />} />
        <Route path="leaderboard" element={<PortalLeaderboard />} />
        <Route path="search" element={<PortalSearch />} />
        <Route path="certificate/:kind/:id" element={<PortalCertificate />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/new" element={<ReportNew />} />
        <Route path="reports/:id" element={<ReportDetail />} />
        <Route path="training" element={<Training />} />
        <Route path="training/:id" element={<CourseDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="admin/login" element={<AdminLogin />} />
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<AdminOverview />} />
        <Route path="roster" element={<AdminRoster />} />
        <Route path="roster-dividers" element={<AdminRosterDividers />} />
        <Route path="divisions" element={<AdminDivisions />} />
        <Route path="leadership" element={<AdminLeadership />} />
        <Route path="news" element={<AdminNews />} />
        <Route path="documents" element={<AdminDocuments />} />
        <Route path="internal-affairs" element={<IAList />} />
        <Route path="internal-affairs/cases" element={<IACases />} />
        <Route path="internal-affairs/:id" element={<IADetail />} />
        <Route path="accounts" element={<RequirePerm perm="owner"><Accounts /></RequirePerm>} />
        <Route path="roles" element={<RequirePerm perm="owner"><RolesAdmin /></RequirePerm>} />
        <Route path="settings" element={<Settings />} />
        <Route path="password" element={<ChangePassword />} />
        <Route path="personnel" element={<RequirePerm perm="command"><RequestsAdmin /></RequirePerm>} />
        <Route path="members" element={<RequirePerm perm={["command", "ia", "training"]}><PersonnelDirectory /></RequirePerm>} />
        <Route path="members/:id" element={<RequirePerm perm={["command", "ia", "training"]}><MemberAdmin /></RequirePerm>} />
        <Route path="discipline" element={<RequirePerm perm="ia"><DisciplineAdmin /></RequirePerm>} />
        <Route path="divisions/:id/members" element={<RequirePerm perm={["content", "command"]}><UnitMembersAdmin /></RequirePerm>} />
        <Route path="activity" element={<RequirePerm perm="command"><ActivityAdmin /></RequirePerm>} />
        <Route path="audit" element={<RequirePerm perm="admin"><AuditAdmin /></RequirePerm>} />
        <Route path="announcements" element={<RequirePerm perm={["content", "command"]}><AnnouncementsAdmin /></RequirePerm>} />
        <Route path="events" element={<RequirePerm perm={["content", "command", "training"]}><EventsAdmin /></RequirePerm>} />
        <Route path="ranks" element={<RequirePerm perm="admin"><RanksAdmin /></RequirePerm>} />
        <Route path="faqs" element={<RequirePerm perm="content"><FaqAdmin /></RequirePerm>} />
        <Route path="pages" element={<RequirePerm perm="content"><PagesAdmin /></RequirePerm>} />
        <Route path="feedback" element={<RequirePerm perm={["content", "command"]}><FeedbackAdmin /></RequirePerm>} />
        <Route path="courses" element={<RequirePerm perm="training"><CoursesAdmin /></RequirePerm>} />
        <Route path="training-records" element={<RequirePerm perm="training"><TrainingRecordsAdmin /></RequirePerm>} />
        <Route path="broadcast" element={<RequirePerm perm="command"><BroadcastAdmin /></RequirePerm>} />
        <Route path="site" element={<RequirePerm perm="admin"><SiteConfigAdmin /></RequirePerm>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
