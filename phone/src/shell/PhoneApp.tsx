// Route table of the phone app (router basename /phone, set in main.tsx).
// Each area is lazy-loaded from its own folder, so parallel work on areas never touches this file.
import { lazy } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import { useViewportCssVars } from "@phone/ui";
import { Onboarding, SignIn, Welcome } from "./AuthScreens";
import { PhoneGate } from "./Gate";
import { PhoneLayout } from "./Layout";
import { NotFound } from "./NotFound";

const Home = lazy(() => import("@phone/areas/home"));
const Games = lazy(() => import("@phone/areas/home/Games"));
const Quiz = lazy(() => import("@phone/areas/quiz"));
const Flags = lazy(() => import("@phone/areas/geo/flags"));
const Capitals = lazy(() => import("@phone/areas/geo/capitals"));
const Recall = lazy(() => import("@phone/areas/typing/recall"));
const Elimination = lazy(() => import("@phone/areas/typing/elimination"));
const Explorer = lazy(() => import("@phone/areas/explore"));
const Profile = lazy(() => import("@phone/areas/account/profile"));
const Settings = lazy(() => import("@phone/areas/account/settings"));

export function PhoneApp() {
  useViewportCssVars();
  return (
    <Routes>
      <Route path="welcome" element={<Welcome />} />
      <Route path="sign-in" element={<SignIn />} />
      <Route
        element={
          <PhoneGate>
            <Outlet />
          </PhoneGate>
        }
      >
        <Route path="onboarding" element={<Onboarding />} />
        <Route element={<PhoneLayout />}>
          <Route index element={<Home />} />
          <Route path="games" element={<Games />} />
          <Route path="quiz/*" element={<Quiz />} />
          <Route path="flags/*" element={<Flags />} />
          <Route path="capitals/*" element={<Capitals />} />
          <Route path="recall/*" element={<Recall />} />
          <Route path="elimination/*" element={<Elimination />} />
          <Route path="explorer/*" element={<Explorer />} />
          <Route path="profile/*" element={<Profile />} />
          <Route path="settings/*" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
