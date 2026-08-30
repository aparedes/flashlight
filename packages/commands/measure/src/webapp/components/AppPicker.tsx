import * as React from "react";
import { styled, alpha } from "@mui/material/styles";
import InputBase from "@mui/material/InputBase";
import Autocomplete from "@mui/material/Autocomplete";
import { AppInfo, Platform } from "@lantern/types";
import { PlatformIcon } from "./PlatformBadge";

const Search = styled("div")(({ theme }) => ({
  position: "relative",
  borderRadius: theme.shape.borderRadius,
  backgroundColor: alpha(theme.palette.common.white, 0.15),
  "&:hover": {
    backgroundColor: alpha(theme.palette.common.white, 0.25),
  },
  marginLeft: 0,
  width: 300,
}));

const SearchIconWrapper = styled("div")(() => ({
  paddingLeft: 10,
  paddingRight: 10,
  height: "100%",
  position: "absolute",
  pointerEvents: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: "inherit",
  "& .MuiInputBase-input": {
    padding: 10,
    // vertical padding + font size from searchIcon
    paddingLeft: 45,
    transition: theme.transitions.create("width"),
    width: 300 - 45 - 10,
  },
}));

export const AppPicker = ({
  apps,
  platform,
  value,
  onChange,
  onOpen,
}: {
  apps: AppInfo[];
  platform: Platform;
  value: string;
  onChange: (bundleId: string) => void;
  onOpen: () => void;
}) => (
  <Search>
    <SearchIconWrapper>
      <PlatformIcon platform={platform} />
    </SearchIconWrapper>
    <Autocomplete
      freeSolo
      options={apps}
      getOptionLabel={(option) => (typeof option === "string" ? option : option.bundleId)}
      inputValue={value}
      onInputChange={(_, newValue) => onChange(newValue)}
      onOpen={onOpen}
      renderOption={(props, option) => (
        <li {...props} key={option.bundleId}>
          <span>{option.name}</span>
          <span className="text-neutral-500 ml-2">{option.bundleId}</span>
          {option.isRunning ? <span className="ml-2 text-success">● running</span> : null}
        </li>
      )}
      renderInput={(params) => (
        <StyledInputBase
          ref={params.slotProps.input.ref}
          className={params.slotProps.input.className}
          endAdornment={params.slotProps.input.endAdornment}
          inputProps={params.slotProps.htmlInput}
          placeholder="Bundle id — type or pick an installed app"
        />
      )}
    />
  </Search>
);
