import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider, theme } from "antd";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#7c6cf2",
          colorBgBase: "#090b10",
          colorBgContainer: "#11131a",
          colorBgElevated: "#171a22",
          colorText: "#e8eaf0",
          colorTextSecondary: "#9da3b4",
          colorTextTertiary: "#737b8e",
          colorBorder: "#303541",
          colorBorderSecondary: "#242934",
          borderRadius: 8,
          fontFamily: "Inter, system-ui, sans-serif",
        },
        components: {
          Button: { controlHeight: 36 },
          Card: { colorBgContainer: "#11131a" },
          Modal: { contentBg: "#11131a", headerBg: "#11131a" },
          Table: { headerBg: "#171a22", colorBgContainer: "#11131a" },
          Select: { selectorBg: "#11131a", optionSelectedBg: "#25213f" },
          Input: { colorBgContainer: "#0d0f15" },
          InputNumber: { colorBgContainer: "#0d0f15" },
        },
      }}
    >
      <AntApp><App /></AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
