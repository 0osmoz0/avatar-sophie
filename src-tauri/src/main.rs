// Empeche l'ouverture d'une console supplementaire sur Windows en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    avatar_sophie_lib::run()
}
