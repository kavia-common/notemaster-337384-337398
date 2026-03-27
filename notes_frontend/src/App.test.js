import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders NoteMaster header", () => {
  render(<App />);
  const title = screen.getByText(/notemaster/i);
  expect(title).toBeInTheDocument();
});
