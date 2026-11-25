import Header from "./Header.jsx";
import Footer from "./Footer.jsx";

export default function Layout({ children }) {
  return (
    <>
      <div id="top" />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Header />
      <main className="public-site" id="main-content" tabIndex="-1">{children}</main>
      <Footer />
    </>
  );
}